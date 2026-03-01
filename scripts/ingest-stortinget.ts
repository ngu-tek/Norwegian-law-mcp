#!/usr/bin/env tsx
/**
 * Stortinget Open Data — Preparatory Works Ingestion
 *
 * Fetches Norwegian parliamentary documents from data.stortinget.no:
 *   - Propositions (Prop. L/S) — government bills
 *   - Committee recommendations (Innst.) — committee reports
 *   - Legislative decisions (Lovvedtak)
 *
 * The Stortinget Open Data API is PUBLIC DOMAIN and freely reusable
 * with attribution to Stortinget.
 *
 * Data flow:
 *   data.stortinget.no API → this script → database.db (preparatory_works + preparatory_works_full)
 *
 * Usage:
 *   npm run ingest:stortinget
 *   npm run ingest:stortinget -- --limit 50
 *   npm run ingest:stortinget -- --resume
 *   npm run ingest:stortinget -- --dry-run
 *   npm run ingest:stortinget -- --sessions 2020-2021,2021-2022
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DB_PATH = path.resolve(__dirname, '../data/database.db');
const API_BASE = 'https://data.stortinget.no/eksport';
const REQUEST_DELAY_MS = 400;
const USER_AGENT = 'Norwegian-Law-MCP/1.0 (https://github.com/Ansvar-Systems/norwegian-law-mcp; hello@ansvar.ai)';

// Stortinget API returns XML by default; JSON via ?format=json
const JSON_FMT = 'format=json';

// Session range for ingestion (Stortinget data starts from 1986-87)
const DEFAULT_START_SESSION = '1998-99';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StortingetSession {
  id: string;
  fra: string;
  til: string;
}

interface StortingetSak {
  id: number;
  tittel: string;
  korttittel: string;
  henvisning: string;
  dokumentgruppe: number;
  type: number;
  status: number;
  behandlet_sesjon_id: string | null;
  sak_sesjon: string;
  sak_nummer: number;
  emne_liste: Array<{ id: number; navn: string; hovedemne_id: number; er_hovedemne: boolean }>;
  komite?: { id: number; navn: string };
  publikasjonsReferanse_liste?: Array<{
    lenke_tekst: string;
    lenke_url: string;
    type: number;
    undertype: number;
  }>;
}

interface StortingetPublikasjon {
  id: string;
  tittel: string;
  type: number;
  dato: string;
  tilgjengelig_dato: number;
  publikasjonformat_liste: string[];
  publikasjonsPdfer: Array<{ url: string; tittel: string }> | null;
}

interface PrepWorkRecord {
  doc_id: string;
  doc_type: 'bill' | 'sou' | 'ds';
  title: string;
  summary: string | null;
  issued_date: string | null;
  url: string | null;
  full_text: string | null;
  section_summaries: string | null;
  linked_statute_ids: string[];
  session_id: string;
  stortinget_sak_id: number | null;
}

interface CliArgs {
  limit: number;
  resume: boolean;
  dryRun: boolean;
  sessions: string[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.json() as Promise<T>;
}

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/xml, text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.text();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a Stortinget date value.
 * The API returns dates in two formats:
 *   - "/Date(1728651615000)/" (millisecond timestamp)
 *   - "2024-10-11T12:00:00" (ISO-ish)
 */
function parseStortingetDate(dateValue: string | number | null | undefined): string | null {
  if (dateValue == null) return null;

  if (typeof dateValue === 'number') {
    // Millisecond timestamp
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const str = String(dateValue);

  // /Date(1728651615000)/
  const msMatch = str.match(/\/Date\((\d+)\)\//);
  if (msMatch) {
    const d = new Date(parseInt(msMatch[1], 10));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  // ISO date
  const isoMatch = str.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  return null;
}

/**
 * Parse the 'henvisning' field to extract document references.
 *
 * Post-2009 formats:
 *   "Prop. 166 L (2024-2025)"
 *   "Prop. 166 L (2024-2025), Innst. 127 L (2025-2026)"
 *   "Meld. St. 12 (2023-2024)"
 *
 * Pre-2009 formats:
 *   "Ot.prp. nr. 44 (2001-2002)"   — Odelstingsproposisjon (law bills)
 *   "St.prp. nr. 1 (2003-2004)"    — Stortingsproposisjon (budget/policy)
 *   "St.meld. nr. 17 (2002-2003)"  — Stortingsmelding (government report)
 *   "Innst. O. nr. 72 (2001-2002)" — Odelstingsinnstilling (law committee rec.)
 *   "Innst. S. nr. 10 (2003-2004)" — Stortingsinnstilling (policy committee rec.)
 */
function parseHenvisning(text: string): {
  propositions: Array<{ type: string; number: string; category: string; session: string; full: string }>;
  innstillinger: Array<{ number: string; category: string; session: string; full: string }>;
} {
  const propositions: Array<{ type: string; number: string; category: string; session: string; full: string }> = [];
  const innstillinger: Array<{ number: string; category: string; session: string; full: string }> = [];

  // --- Post-2009 formats ---

  // Prop. NNN L/S (YYYY-YYYY) or Prop. NNN LS (YYYY-YYYY)
  const propPattern = /(Prop\.\s*(\d+)\s*(L|S|LS)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(propPattern)) {
    propositions.push({
      type: 'Prop.',
      number: match[2],
      category: match[3],
      session: match[4],
      full: match[1].trim(),
    });
  }

  // Meld. St. NNN (YYYY-YYYY)
  const meldPattern = /(Meld\.\s*St\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(meldPattern)) {
    propositions.push({
      type: 'Meld. St.',
      number: match[2],
      category: 'S',
      session: match[3],
      full: match[1].trim(),
    });
  }

  // Innst. NNN L/S (YYYY-YYYY)
  const innstPattern = /(Innst\.\s*(\d+)\s*(L|S|LS)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(innstPattern)) {
    innstillinger.push({
      number: match[2],
      category: match[3],
      session: match[4],
      full: match[1].trim(),
    });
  }

  // --- Pre-2009 formats ---

  // Ot.prp. nr. NNN (YYYY-YYYY) — legislative bill from government
  const otprpPattern = /(Ot\.prp\.\s*nr\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(otprpPattern)) {
    propositions.push({
      type: 'Ot.prp.',
      number: match[2],
      category: 'L',
      session: match[3],
      full: match[1].trim(),
    });
  }

  // St.prp. nr. NNN (YYYY-YYYY) — budget/policy proposition
  const stprpPattern = /(St\.prp\.\s*nr\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(stprpPattern)) {
    propositions.push({
      type: 'St.prp.',
      number: match[2],
      category: 'S',
      session: match[3],
      full: match[1].trim(),
    });
  }

  // St.meld. nr. NNN (YYYY-YYYY) — government report to parliament
  const stmeldPattern = /(St\.meld\.\s*nr\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(stmeldPattern)) {
    propositions.push({
      type: 'St.meld.',
      number: match[2],
      category: 'S',
      session: match[3],
      full: match[1].trim(),
    });
  }

  // Innst. O. nr. NNN (YYYY-YYYY) — Odelstingsinnstilling (law committee)
  const innstOPattern = /(Innst\.\s*O\.\s*nr\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(innstOPattern)) {
    innstillinger.push({
      number: match[2],
      category: 'L',
      session: match[3],
      full: match[1].trim(),
    });
  }

  // Innst. S. nr. NNN (YYYY-YYYY) — Stortingsinnstilling (policy committee)
  const innstSPattern = /(Innst\.\s*S\.\s*nr\.\s*(\d+)\s*\((\d{4}-\d{4})\))/g;
  for (const match of text.matchAll(innstSPattern)) {
    innstillinger.push({
      number: match[2],
      category: 'S',
      session: match[3],
      full: match[1].trim(),
    });
  }

  return { propositions, innstillinger };
}

/**
 * Generate a stable document ID for a preparatory work.
 * Format: "prop-{number}-{category}-{session}" or "innst-{number}-{category}-{session}"
 */
function makeDocId(
  type: 'prop' | 'innst' | 'meld-st' | 'otprp' | 'stprp' | 'stmeld',
  number: string,
  category: string,
  session: string,
): string {
  return `${type}-${number}-${category.toLowerCase()}-${session}`;
}

/**
 * Try to match a proposition to an existing statute in the database.
 * Matches on title keywords — e.g. "Endringer i vergemålsloven" matches a statute
 * whose title contains "vergemålsloven".
 */
function findLinkedStatutes(
  db: ReturnType<typeof Database>,
  sakTitle: string,
): string[] {
  // Extract law names from the case title
  // Patterns: "Endringer i <lawname>", "Lov om <lawname>"
  const lawNamePatterns = [
    /(?:Endringer?\s+i|Lov\s+om)\s+(.+?)(?:\s*\(|$)/i,
    /(?:endringer?\s+i|lov\s+om)\s+(.+?)(?:\s*mv\.|\s*m\.m\.|\s*og\s+|\s*,|$)/i,
  ];

  const candidates: string[] = [];

  for (const pattern of lawNamePatterns) {
    const match = sakTitle.match(pattern);
    if (match) {
      const lawName = normalizeWhitespace(match[1]).replace(/\s*\(.*\)\s*$/, '');
      if (lawName.length > 3) {
        candidates.push(lawName);
      }
    }
  }

  if (candidates.length === 0) return [];

  const results: string[] = [];
  const stmt = db.prepare(
    `SELECT id FROM legal_documents WHERE type = 'statute' AND title LIKE ?`
  );

  for (const candidate of candidates) {
    const rows = stmt.all(`%${candidate}%`) as Array<{ id: string }>;
    for (const row of rows) {
      if (!results.includes(row.id)) {
        results.push(row.id);
      }
    }
  }

  return results;
}

/**
 * Extract plain text from Stortinget publication XML.
 * The XML structure uses Innstilling/Startseksjon/Hovedseksjon/Sluttseksjon
 * with nested Kapittel, A (paragraph), and other elements.
 */
function extractTextFromPublicationXml(xml: string): {
  fullText: string;
  sectionSummaries: Record<string, string>;
  ingress: string | null;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    isArray: (name: string) => {
      return ['Kapittel', 'A', 'Paragraf', 'Ledd', 'Bokstav', 'Nummer', 'Tabell', 'TabellRad', 'TabellCelle'].includes(name);
    },
  });

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return { fullText: '', sectionSummaries: {}, ingress: null };
  }

  const sections: string[] = [];
  const sectionSummaries: Record<string, string> = {};
  let ingress: string | null = null;

  // Navigate the XML structure — could be Innstilling, Proposisjon, etc.
  const root = parsed.Innstilling ?? parsed.Proposisjon ?? parsed.Melding ?? parsed.Lovvedtak ?? parsed;

  // Extract ingress from Startseksjon
  if (root.Startseksjon) {
    const start = root.Startseksjon;
    if (start.Ingress) {
      ingress = extractTextContent(start.Ingress);
    }
  }

  // Extract chapters from Hovedseksjon
  if (root.Hovedseksjon?.Kapittel) {
    const chapters = Array.isArray(root.Hovedseksjon.Kapittel)
      ? root.Hovedseksjon.Kapittel
      : [root.Hovedseksjon.Kapittel];

    for (const chapter of chapters) {
      const chapterTitle = chapter['@_tittel'] ?? chapter.Tittel ?? '';
      const chapterText = extractTextContent(chapter);
      if (chapterText) {
        sections.push(chapterText);
        if (chapterTitle) {
          // First 500 chars as section summary
          sectionSummaries[normalizeWhitespace(String(chapterTitle))] =
            normalizeWhitespace(chapterText).slice(0, 500);
        }
      }
    }
  }

  // Extract Sluttseksjon (recommendations/decisions)
  if (root.Sluttseksjon) {
    const endText = extractTextContent(root.Sluttseksjon);
    if (endText) {
      sections.push(endText);
    }
  }

  return {
    fullText: sections.join('\n\n'),
    sectionSummaries,
    ingress,
  };
}

/**
 * Recursively extract text content from any XML node.
 */
function extractTextContent(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);

  const parts: string[] = [];

  if (node['#text'] != null) {
    parts.push(String(node['#text']));
  }

  for (const key of Object.keys(node)) {
    if (key === '#text' || key.startsWith('@_')) continue;

    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const text = extractTextContent(item);
        if (text) parts.push(text);
      }
    } else {
      const text = extractTextContent(child);
      if (text) parts.push(text);
    }
  }

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// API fetchers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSessions(): Promise<StortingetSession[]> {
  const url = `${API_BASE}/sesjoner?${JSON_FMT}`;
  const data = await fetchJson<{ sesjoner_liste: StortingetSession[] }>(url);
  return data.sesjoner_liste ?? [];
}

async function fetchCasesForSession(sessionId: string): Promise<StortingetSak[]> {
  const url = `${API_BASE}/saker?sesjonid=${encodeURIComponent(sessionId)}&${JSON_FMT}`;
  const data = await fetchJson<{ saker_liste: StortingetSak[] }>(url);
  return data.saker_liste ?? [];
}

async function fetchCaseDetails(sakId: number): Promise<StortingetSak | null> {
  try {
    const url = `${API_BASE}/sak?sakid=${sakId}&${JSON_FMT}`;
    return await fetchJson<StortingetSak>(url);
  } catch {
    return null;
  }
}

async function fetchPublicationsForSession(
  sessionId: string,
  type: string,
): Promise<StortingetPublikasjon[]> {
  try {
    const url = `${API_BASE}/publikasjoner?publikasjontype=${type}&sesjonid=${encodeURIComponent(sessionId)}&${JSON_FMT}`;
    const data = await fetchJson<{ publikasjoner_liste: StortingetPublikasjon[] }>(url);
    return data.publikasjoner_liste ?? [];
  } catch {
    return [];
  }
}

async function fetchPublicationXml(publicationId: string): Promise<string | null> {
  try {
    return await fetchXml(`${API_BASE}/publikasjon?publikasjonid=${encodeURIComponent(publicationId)}`);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    limit: 0,
    resume: false,
    dryRun: false,
    sessions: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        result.limit = parseInt(args[++i] ?? '0', 10);
        break;
      case '--resume':
        result.resume = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--sessions':
        result.sessions = (args[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean);
        break;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ingestion logic
// ─────────────────────────────────────────────────────────────────────────────

async function ingestStortinget(): Promise<void> {
  const args = parseArgs();

  console.log('Stortinget Open Data — Preparatory Works Ingestion');
  console.log('='.repeat(70));
  console.log(`  Source:  data.stortinget.no (Public Domain, Stortinget Open Data)`);
  console.log(`  License: Free reuse with attribution to Stortinget`);
  console.log(`  Mode:    ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Resume:  ${args.resume}`);
  if (args.limit > 0) console.log(`  Limit:   ${args.limit} cases`);
  if (args.sessions) console.log(`  Sessions: ${args.sessions.join(', ')}`);
  console.log('');

  // Open database
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    console.error('Run "npm run build:db && npm run build:db:paid" first.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Ensure premium tables exist
  const hasPrepFull = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='preparatory_works_full'"
  ).get();
  if (!hasPrepFull) {
    console.error('ERROR: Premium tables not found. Run "npm run build:db:paid" first.');
    db.close();
    process.exit(1);
  }

  // Prepared statements
  const insertDoc = db.prepare(`
    INSERT OR IGNORE INTO legal_documents (id, type, title, title_en, short_name, status, issued_date, in_force_date, url, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPrepWork = db.prepare(`
    INSERT OR IGNORE INTO preparatory_works (statute_id, prep_document_id, title, summary)
    VALUES (?, ?, ?, ?)
  `);

  const insertPrepWorkFull = db.prepare(`
    INSERT OR REPLACE INTO preparatory_works_full (prep_work_id, full_text, section_summaries)
    VALUES (?, ?, ?)
  `);

  const findPrepWorkId = db.prepare(`
    SELECT id FROM preparatory_works WHERE prep_document_id = ?
  `);

  const existsDoc = db.prepare(`
    SELECT 1 FROM legal_documents WHERE id = ?
  `);

  // Fetch sessions
  console.log('Fetching available sessions...');
  const allSessions = await fetchSessions();
  await delay(REQUEST_DELAY_MS);

  // Filter sessions
  let sessions: StortingetSession[];
  if (args.sessions) {
    sessions = allSessions.filter(s => args.sessions!.includes(s.id));
    if (sessions.length === 0) {
      console.error(`ERROR: No matching sessions found. Available: ${allSessions.map(s => s.id).join(', ')}`);
      db.close();
      process.exit(1);
    }
  } else {
    // Use sessions from DEFAULT_START_SESSION onward.
    // The API returns sessions in reverse chronological order (newest first),
    // so we need to include everything from index 0 up to the start session.
    const startIdx = allSessions.findIndex(s => s.id === DEFAULT_START_SESSION);
    sessions = startIdx >= 0 ? allSessions.slice(0, startIdx + 1) : allSessions;
  }

  // Sort sessions chronologically
  sessions.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`  Processing ${sessions.length} sessions: ${sessions[0].id} to ${sessions[sessions.length - 1].id}`);
  console.log('');

  // Counters
  let totalCasesProcessed = 0;
  let totalPropsCreated = 0;
  let totalInnstsCreated = 0;
  let totalLinksCreated = 0;
  let totalFullTexts = 0;
  let totalSkipped = 0;

  for (const session of sessions) {
    if (args.limit > 0 && totalCasesProcessed >= args.limit) break;

    console.log(`--- Session: ${session.id} ---`);

    // Fetch all cases for this session
    let cases: StortingetSak[];
    try {
      cases = await fetchCasesForSession(session.id);
      await delay(REQUEST_DELAY_MS);
    } catch (err) {
      console.log(`  ERROR: Failed to fetch cases: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // Filter to legislative cases (dokumentgruppe=1 for bills)
    // and stortingsmeldinger (dokumentgruppe=2 for reports)
    const legislativeCases = cases.filter(c =>
      c.dokumentgruppe === 1 || c.dokumentgruppe === 2
    );

    console.log(`  Total cases: ${cases.length}, legislative: ${legislativeCases.length}`);

    // Also fetch innstillinger publications for this session
    const innstillingPublications = await fetchPublicationsForSession(session.id, 'innstilling');
    await delay(REQUEST_DELAY_MS);
    const innstillingMap = new Map<string, StortingetPublikasjon>();
    for (const pub of innstillingPublications) {
      innstillingMap.set(pub.id, pub);
    }
    console.log(`  Innstillinger publications available: ${innstillingPublications.length}`);

    for (const sak of legislativeCases) {
      if (args.limit > 0 && totalCasesProcessed >= args.limit) break;
      totalCasesProcessed++;

      const henvisning = sak.henvisning ?? '';
      const parsed = parseHenvisning(henvisning);

      if (parsed.propositions.length === 0 && parsed.innstillinger.length === 0) {
        totalSkipped++;
        continue;
      }

      console.log(`  Case ${sak.id}: ${sak.korttittel || sak.tittel}`);
      console.log(`    Ref: ${henvisning}`);

      // Find linked statutes in DB
      const linkedStatutes = findLinkedStatutes(db, sak.tittel);

      // Process propositions (Prop. / Meld. St.)
      for (const prop of parsed.propositions) {
        const docTypeMap: Record<string, 'prop' | 'meld-st' | 'otprp' | 'stprp' | 'stmeld'> = {
          'Prop.': 'prop',
          'Meld. St.': 'meld-st',
          'Ot.prp.': 'otprp',
          'St.prp.': 'stprp',
          'St.meld.': 'stmeld',
        };
        const docType = docTypeMap[prop.type] ?? 'prop';
        const docId = makeDocId(docType, prop.number, prop.category, prop.session);

        // Resume check
        if (args.resume && existsDoc.get(docId)) {
          console.log(`    SKIP (exists): ${prop.full}`);
          totalSkipped++;
          continue;
        }

        if (args.dryRun) {
          console.log(`    DRY: Would insert ${prop.full} as ${docId}`);
          totalPropsCreated++;
          continue;
        }

        // Insert as legal_document
        insertDoc.run(
          docId,
          'bill',
          prop.full,
          null, // title_en
          null, // short_name
          'in_force',
          null, // issued_date — we get this from case details if needed
          null, // in_force_date
          `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${sak.id}`,
          sak.tittel,
        );
        totalPropsCreated++;

        // Link to statutes
        for (const statuteId of linkedStatutes) {
          try {
            insertPrepWork.run(statuteId, docId, prop.full, sak.tittel);
            totalLinksCreated++;
          } catch {
            // Duplicate or FK constraint — fine
          }
        }

        console.log(`    + ${prop.full} -> ${linkedStatutes.length} statute(s)`);
      }

      // Process innstillinger
      for (const innst of parsed.innstillinger) {
        const docId = makeDocId('innst', innst.number, innst.category, innst.session);

        if (args.resume && existsDoc.get(docId)) {
          console.log(`    SKIP (exists): ${innst.full}`);
          totalSkipped++;
          continue;
        }

        // Compute publication ID for fetching full text
        // Format: inns-{YYYYYY}-{NNN}{l|s}
        // Session "2024-2025" -> take first 4 digits + last 2 digits -> "202425"
        const sessionParts = innst.session.split('-');
        const sessionCode = sessionParts[0] + (sessionParts[1] ?? '').slice(-2);
        const paddedNum = innst.number.padStart(3, '0');
        const pubId = `inns-${sessionCode}-${paddedNum}${innst.category.toLowerCase()}`;

        // Try to fetch the full publication XML
        let fullText: string | null = null;
        let sectionSummaries: Record<string, string> = {};
        let ingress: string | null = null;

        if (!args.dryRun) {
          try {
            const xml = await fetchPublicationXml(pubId);
            await delay(REQUEST_DELAY_MS);

            if (xml && xml.length > 100) {
              const extracted = extractTextFromPublicationXml(xml);
              if (extracted.fullText.length > 50) {
                fullText = extracted.fullText;
                sectionSummaries = extracted.sectionSummaries;
                ingress = extracted.ingress;
                totalFullTexts++;
              }
            }
          } catch {
            // Publication not available — metadata only
          }
        }

        const summary = ingress ?? sak.tittel;

        if (args.dryRun) {
          console.log(`    DRY: Would insert ${innst.full} as ${docId}`);
          totalInnstsCreated++;
          continue;
        }

        // Insert as legal_document
        insertDoc.run(
          docId,
          'bill', // innstillinger are committee reports on bills
          innst.full,
          null,
          null,
          'in_force',
          null,
          null,
          `https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/${innst.session}/${pubId}/`,
          summary,
        );
        totalInnstsCreated++;

        // Link to statutes
        if (linkedStatutes.length > 0) {
          for (const statuteId of linkedStatutes) {
            try {
              insertPrepWork.run(statuteId, docId, innst.full, summary);
              totalLinksCreated++;
            } catch {
              // Duplicate or FK constraint
            }
          }
        } else {
          // Self-reference: the innstilling document links to itself so we can
          // store the full text in preparatory_works_full via the FK chain.
          try {
            insertPrepWork.run(docId, docId, innst.full, summary);
          } catch {
            // Duplicate or FK constraint
          }
        }

        // Insert full text if available
        if (fullText) {
          const prepWorkRow = findPrepWorkId.get(docId) as { id: number } | undefined;
          if (prepWorkRow) {
            insertPrepWorkFull.run(
              prepWorkRow.id,
              fullText,
              Object.keys(sectionSummaries).length > 0
                ? JSON.stringify(sectionSummaries)
                : null,
            );
          }
        }

        console.log(
          `    + ${innst.full} -> ${linkedStatutes.length} statute(s)` +
          (fullText ? ` [full text: ${(fullText.length / 1024).toFixed(0)} KB]` : ' [metadata only]')
        );
      }
    }

    console.log('');
  }

  // Update metadata
  if (!args.dryRun) {
    const upsertMeta = db.prepare(
      'INSERT INTO db_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    upsertMeta.run('stortinget_ingested_at', new Date().toISOString());
    upsertMeta.run('stortinget_sessions_processed', sessions.map(s => s.id).join(','));

    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  db.close();

  // Summary
  console.log('='.repeat(70));
  console.log('Stortinget Ingestion Summary');
  console.log(`  Sessions processed:    ${sessions.length}`);
  console.log(`  Cases processed:       ${totalCasesProcessed}`);
  console.log(`  Propositions created:  ${totalPropsCreated}`);
  console.log(`  Innstillinger created: ${totalInnstsCreated}`);
  console.log(`  Statute links created: ${totalLinksCreated}`);
  console.log(`  Full texts fetched:    ${totalFullTexts}`);
  console.log(`  Skipped (existing):    ${totalSkipped}`);
  console.log('');
  console.log('Attribution: Data sourced from Stortinget (data.stortinget.no), Public Domain.');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entrypoint
// ─────────────────────────────────────────────────────────────────────────────

ingestStortinget().catch(error => {
  console.error('Ingestion failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
