# F1 follow-up (lead task, queued behind F2 gate): detector false positives

Source: review-f1 fresh verdict, finding 1 (Medium, non-blocking). MIS-DISPOSITIONED in the
F1 gate record as "subsumed by codex finding 3" - codex 3 was false NEGATIVES (saude);
this is false POSITIVES, empirically confirmed by the reviewer:
- "multi-tenant" -> imobiliario (via 'tenant')
- "tennis court" / "courtesy" -> juridico (via 'court' prefix-match)
- "login seguro" -> seguros (via 'seguro' stem)

Effect is bounded to a spurious PT-PT knowledge-request narration on a generic app (no break,
no leak, no ingest without knowledgeDocs). Plan (after F2 gate closes - do NOT change the
detector while F2's live gate depends on the running dist):
1. Tighten: 'court' -> exact token or multi-word forms ('court fees', 'court case'); 'tenant'
   -> exact token; drop bare 'seguro' (keep seguros/apolice/sinistro/resseguro/segurado).
2. Negative tests: multi-tenant, tennis court, courtesy, login seguro.
3. Re-run domain-scoping + build suites; commit as fix(operator-run/f1); correct the
   gate-status freshReview detail line + RUN_LOG note in the same commit.
Also fold review-f1 Lows: fiscais-plural false-negative; partial-ingest emits no confirmation
(consider narrating partial counts); "área seguros" -> "área de seguros" grammar.
