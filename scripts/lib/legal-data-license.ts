/**
 * Legal data licensing policy controls for Norwegian legal sources.
 *
 * Posture is source-specific and evidence-driven:
 * - Full-text statute ingestion is allowed only where reuse rights are explicit.
 * - Otherwise ingestion is forced to metadata + stable deep links.
 */

export type LegalSource = 'lovdata' | 'lovtidend' | 'domstol' | 'stortinget';

export interface LegalDataLicensePolicy {
  source: LegalSource;
  rights_status: 'allowed' | 'restricted' | 'unclear';
  allow_full_text_cache: boolean;
  allow_full_text_redistribution: boolean;
  allow_metadata_cache: boolean;
  allow_deep_links: boolean;
  fetch_on_demand_required: boolean;
  required_attribution: string;
  policy_notes: string[];
  evidence: string[];
  last_reviewed: string;
}

export interface IngestionDecision {
  mode: 'full_text' | 'metadata_only';
  reason: string;
  policy: LegalDataLicensePolicy;
}

export const LEGAL_DATA_POLICIES: Record<LegalSource, LegalDataLicensePolicy> = {
  lovdata: {
    source: 'lovdata',
    rights_status: 'allowed',
    allow_full_text_cache: true,
    allow_full_text_redistribution: true,
    allow_metadata_cache: true,
    allow_deep_links: true,
    fetch_on_demand_required: false,
    required_attribution: 'Lovdata (official source) with source link and NLOD 2.0 attribution for covered content',
    policy_notes: [
      'Scope: statutes and regulations covered by Lovdata user agreement section 2.3 exception (NLOD 2.0).',
      'Mass/systematic extraction must use official open APIs and respect service limits.',
      'Case-law full text is out of scope for this policy and remains restricted unless explicitly cleared.',
    ],
    evidence: [
      'Lovdata brukeravtale §2.3: explicit NLOD 2.0 exception for Norsk Lovtidend regulations, current formal laws, and current central regulations (copy/use/share allowed with attribution).',
      'Lovdata API landing page states API data may be used to make current regulations available in solutions/services and for AI experimentation/research.',
    ],
    last_reviewed: '2026-02-15',
  },
  lovtidend: {
    source: 'lovtidend',
    rights_status: 'allowed',
    allow_full_text_cache: true,
    allow_full_text_redistribution: true,
    allow_metadata_cache: true,
    allow_deep_links: true,
    fetch_on_demand_required: false,
    required_attribution: 'Norsk Lovtidend / Lovdata with NLOD 2.0 attribution',
    policy_notes: [
      'Scope is legal acts published in Norsk Lovtidend and equivalent covered regulation texts.',
      'Bulk extraction should use official APIs where available.',
    ],
    evidence: [
      'Lovdata brukeravtale §2.3 identifies rule texts in Norsk Lovtidend as reusable under NLOD 2.0.',
    ],
    last_reviewed: '2026-02-15',
  },
  domstol: {
    source: 'domstol',
    rights_status: 'restricted',
    allow_full_text_cache: false,
    allow_full_text_redistribution: false,
    allow_metadata_cache: true,
    allow_deep_links: true,
    fetch_on_demand_required: true,
    required_attribution: 'Official Norwegian court publication channels via deep links',
    policy_notes: [
      'Case-law full text is not cached/redistributed by default in this server.',
      'Use metadata indexing and official-link resolution only unless explicit rights exist.',
    ],
    evidence: [
      'No blanket full-text redistribution approval recorded for Norwegian court publication channels.',
    ],
    last_reviewed: '2026-02-15',
  },
  stortinget: {
    source: 'stortinget',
    rights_status: 'allowed',
    allow_full_text_cache: true,
    allow_full_text_redistribution: true,
    allow_metadata_cache: true,
    allow_deep_links: true,
    fetch_on_demand_required: false,
    required_attribution: 'Stortinget (data.stortinget.no) — cite Stortinget as source',
    policy_notes: [
      'Scope: all parliamentary documents available via data.stortinget.no Open Data API.',
      'Covers propositions (Prop.), committee recommendations (Innst.), legislative decisions (Lovvedtak), parliamentary reports (Meld. St.), and transcripts.',
      'Full text of publications available in XML format via the /eksport/publikasjon endpoint.',
      'Data is public domain — free reuse with attribution.',
    ],
    evidence: [
      'data.stortinget.no states: "Dataene er frie og tilgjengelig for alle, men husk å oppgi Stortinget som kilde."',
      'Stortinget Open Data service: https://data.stortinget.no/om-datatjenesten/',
    ],
    last_reviewed: '2026-02-28',
  },
};

export function resolveLicensePolicy(source: LegalSource): LegalDataLicensePolicy {
  return LEGAL_DATA_POLICIES[source];
}

export function decideIngestionMode(source: LegalSource, wantsFullText: boolean): IngestionDecision {
  const policy = resolveLicensePolicy(source);

  if (!wantsFullText) {
    return {
      mode: 'metadata_only',
      reason: 'Full-text ingestion was not requested; using metadata + deep links.',
      policy,
    };
  }

  if (wantsFullText && policy.allow_full_text_cache && policy.allow_full_text_redistribution) {
    return {
      mode: 'full_text',
      reason: 'Full-text ingestion is explicitly permitted by current policy.',
      policy,
    };
  }

  return {
    mode: 'metadata_only',
    reason: policy.allow_full_text_cache
      ? 'Full-text redistribution is not permitted; using metadata + deep links.'
      : 'Full-text rights are unclear/restricted; using metadata + deep links by default.',
    policy,
  };
}
