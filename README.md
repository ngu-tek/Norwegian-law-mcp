# Norwegian Law MCP Server

**The Lovdata alternative for the AI age.**

[![npm version](https://badge.fury.io/js/@ansvar%2Fnorwegian-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/norwegian-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Norwegian-law-MCP?style=social)](https://github.com/Ansvar-Systems/Norwegian-law-MCP)
[![CI](https://github.com/Ansvar-Systems/Norwegian-law-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Norwegian-law-MCP/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/Norwegian-law-MCP/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/Norwegian-law-MCP/actions/workflows/check-updates.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)](docs/EU_INTEGRATION_GUIDE.md)
[![Provisions](https://img.shields.io/badge/provisions-33%2C521-blue)](docs/EU_INTEGRATION_GUIDE.md)

Query **3,400 Norwegian statutes** -- from Personopplysningsloven and Straffeloven to Arbeidsmiljøloven, Avtaleloven, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Norwegian legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Norwegian legal research is scattered across Lovdata, Rettsdata, Stortinget publications, and EUR-Lex. Whether you're:
- A **lawyer** validating citations in a brief or contract
- A **compliance officer** checking if a statute is still in force or tracking EEA obligations
- A **legal tech developer** building tools on Norwegian law
- A **researcher** tracing legislative history from forarbeider to statute

...you shouldn't need dozens of browser tabs and manual PDF cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Norwegian law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://norwegian-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add norwegian-law --transport http https://norwegian-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "norwegian-law": {
      "type": "url",
      "url": "https://norwegian-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "norwegian-law": {
      "type": "http",
      "url": "https://norwegian-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/norwegian-law-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "norwegian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/norwegian-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "norwegian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/norwegian-law-mcp"]
    }
  }
}
```

## Example Queries

Once connected, just ask naturally (in Norwegian or English):

- *"Hva sier personopplysningsloven § 13 om informasjonssikkerhet?"*
- *"Er forvaltningsloven fortsatt i kraft?"*
- *"Søk etter bestemmelser om personvern i norsk lovgivning"*
- *"Hvilke EU-direktiver implementerer personopplysningsloven?"*
- *"Hvilke norske lover gjennomfører NIS2-direktivet?"*
- *"Hva sier arbeidsmiljøloven om arbeidstakers rettigheter ved oppsigelse?"*
- *"Hent forarbeidene til personopplysningsloven"*
- *"Valider sitatet 'straffeloven § 204'"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 3,400 statutes | Comprehensive Norwegian legislation |
| **Provisions** | 33,521 sections | Full-text searchable with FTS5 |
| **Preparatory Works** | 25,301 documents | Forarbeider (proposisjoner and NOU reports) |
| **Database Size** | ~87 MB | Optimized SQLite, portable |
| **Daily Updates** | Automated | Freshness checks against Lovdata/Stortinget |

**Verified data only** -- every citation is validated against official sources (Lovdata, Stortinget). Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from official Norwegian legal sources (Lovdata, Stortinget)
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by law identifier + chapter/section
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
Lovdata / Stortinget API --> Parse --> SQLite --> FTS5 snippet() --> MCP response
                               ^                        ^
                        Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search Lovdata by law name | Search by plain Norwegian: *"personvern samtykke"* |
| Navigate multi-chapter statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Er denne loven i kraft?" -> check manually | `check_currency` tool -> answer in seconds |
| Find EEA basis -> dig through EUR-Lex | `get_eu_basis` -> linked EU directives instantly |
| Check 5+ sites for updates | Daily automated freshness checks |
| No API, no integration | MCP protocol -> AI-native |

**Traditional:** Search Lovdata -> Navigate PDF -> Ctrl+F -> Cross-reference with forarbeider -> Check EUR-Lex for EEA basis -> Repeat

**This MCP:** *"Hvilket EU-direktiv ligger til grunn for personopplysningsloven § 13 om informasjonssikkerhet?"* -> Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 search on 33,521 provisions with BM25 ranking |
| `get_provision` | Retrieve specific provision by law identifier + chapter/section |
| `validate_citation` | Validate citation against database (zero-hallucination check) |
| `build_legal_stance` | Aggregate citations from statutes and preparatory works |
| `format_citation` | Format citations per Norwegian conventions (full/short/pinpoint) |
| `check_currency` | Check if statute is in force, amended, or repealed |
| `list_sources` | List all available statutes with metadata, coverage scope, and data provenance |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### EU/EEA Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get EU directives/regulations for Norwegian statute (via EEA Agreement) |
| `get_norwegian_implementations` | Find Norwegian laws implementing EU/EEA act |
| `search_eu_implementations` | Search EU documents with Norwegian implementation counts |
| `get_provision_eu_basis` | Get EU/EEA law references for specific provision |
| `validate_eu_compliance` | Check EEA implementation status (requires EU MCP for full text) |

---

## EU/EEA Law Integration

Norway is an EEA member state implementing EU directives via the EEA Agreement. This means:

- **GDPR** is implemented in Norwegian law via Personopplysningsloven (2018)
- **NIS2 Directive** shapes Norwegian cybersecurity legislation
- **eIDAS Regulation** applies via the EEA Agreement to Norwegian eID schemes
- **DORA** and **AI Act** are being incorporated through the EEA Joint Committee process
- Norway participates in the EU internal market for goods, services, capital, and persons -- meaning the vast majority of EU single market legislation applies in Norway via EEA incorporation

The EU/EEA integration tools provide bi-directional lookup between Norwegian statutes and their EU/EEA basis.

> **Note:** Norway is not an EU member state and does not participate in EU political institutions (Council, Parliament, Commission). EEA incorporation follows a separate process via the EEA Joint Committee. Some EU acts (Common Foreign and Security Policy, Customs Union, Agriculture/Fisheries) do not apply to Norway.

---

## Data Sources & Freshness

All content is sourced from authoritative Norwegian legal databases:

- **[Lovdata](https://lovdata.no/)** -- Official Norwegian legal database (primary source)
- **[Stortinget](https://stortinget.no/)** -- Norwegian Parliament's legislative publications
- **[EUR-Lex](https://eur-lex.europa.eu/)** -- Official EU law database (EEA metadata)

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors all data sources:

| Source | Check | Method |
|--------|-------|--------|
| **Statute amendments** | Lovdata date comparison | All 3,400 statutes checked |
| **New statutes** | Lovdata publications (90-day window) | Diffed against database |
| **Preparatory works** | Stortinget proposition feed (30-day window) | New proposisjoner detected |
| **EEA reference staleness** | Git commit timestamps | Flagged if >90 days old |

The workflow supports `auto_update: true` dispatch for automated sync, rebuild, version bump, and npm publishing.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official Lovdata/Stortinget publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is limited** -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **EEA cross-references** are extracted from Norwegian statute text and EEA Joint Committee decisions, not EUR-Lex full text
> - **Licensing note:** Lovdata's full database is commercial. This server uses publicly available content only

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for Den Norske Advokatforening compliance guidance.

---

## Documentation

- **[EU/EEA Integration Guide](docs/EU_INTEGRATION_GUIDE.md)** -- Detailed EEA cross-reference documentation
- **[Security Policy](SECURITY.md)** -- Vulnerability reporting and scanning details
- **[Disclaimer](DISCLAIMER.md)** -- Legal disclaimers and professional use notices
- **[Privacy](PRIVACY.md)** -- Client confidentiality and data handling

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Norwegian-law-MCP
cd Norwegian-law-MCP
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest                    # Ingest statutes from Lovdata
npm run build:db                  # Rebuild SQLite database
npm run sync:prep-works           # Sync forarbeider (proposisjoner, NOUer)
npm run check-updates             # Check for amendments
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Database Size:** ~87 MB (efficient, portable)
- **Reliability:** 100% ingestion success rate

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### [@ansvar/swedish-law-mcp](https://github.com/Ansvar-Systems/swedish-law-mcp)
**Query 2,415 Swedish statutes directly from Claude** -- DSL, BrB, ABL, MB, and more. Full provision text with EU cross-references. `npx @ansvar/swedish-law-mcp`

### [@ansvar/danish-law-mcp](https://github.com/Ansvar-Systems/danish-law-mcp)
**Query Danish statutes directly from Claude** -- Databeskyttelsesloven, Straffeloven, and more. `npx @ansvar/danish-law-mcp`

### [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp)
**Query 261 security frameworks** -- ISO 27001, NIST CSF, SOC 2, CIS Controls, SCF, and more. `npx @ansvar/security-controls-mcp`

**70+ national law MCPs** covering Australia, Brazil, Canada, Colombia, Denmark, Finland, France, Germany, Ireland, Italy, Japan, Netherlands, Serbia, Slovenia, South Korea, Sweden, Taiwan, UK, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion (Høyesterett, lagmannsrettene)
- EEA cross-reference expansion
- Historical statute versions and amendment tracking
- Lower court decisions (tingrettene)

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Full corpus ingestion (3,400 statutes, 33,521 provisions)
- [x] Preparatory works (25,301 forarbeider)
- [x] EEA law integration tools
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [ ] Court case law expansion (Høyesterett archive)
- [ ] Lower court coverage (lagmannsrett, tingrett)
- [ ] Historical statute versions (amendment tracking)
- [ ] English translations for key statutes

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{norwegian_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Norwegian Law MCP Server: Production-Grade Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Norwegian-law-MCP},
  note = {3,400 Norwegian statutes with 33,521 provisions and 25,301 preparatory works}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Forarbeider:** Norwegian Government (public domain -- publicly available content from Lovdata and Stortinget)
- **EEA Metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the European market. This MCP server started as our internal reference tool for Norwegian law -- turns out everyone building for the Norwegian and EEA market has the same research frustrations.

So we're open-sourcing it. Navigating 3,400 statutes and 25,301 forarbeider shouldn't require a law degree.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
