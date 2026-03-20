# ByteRover Research Paper — Draft

**Status:** Draft v0.1 — Not ready for submission

## Notes for Contributors

### 1. This is a draft version
The paper structure, writing, and formalization are in place but all experimental results are placeholder `[TODO]` markers. Figures (architecture diagrams, retrieval pipeline, context tree) also need to be created.

### 2. Experiments need adjustment
The current experiment section is modeled after MAGMA and the Anatomy survey benchmarks (LoCoMo, LongMemEval). **These need to be adjusted to match our actual benchmark setup.** Specifically:
- Choose which benchmarks we can realistically run against (LoCoMo, LongMemEval, or our own)
- Decide which baselines we compare against and whether we use published numbers or re-run them
- Define our efficiency metrics based on our actual tiered retrieval implementation
- Fill in all `[TODO]` placeholders with real data

### 3. Feel free to remove sections
If any section feels unnecessary or doesn't fit the final narrative, remove it. Candidates to consider:
- Multi-agent coordination (Section 3.5) — could move to appendix if it dilutes the core contribution
- Infrastructure comparison table — may be better as a discussion point than a standalone table
- Some appendix sections (case studies, prompt library) — include only if we have concrete content

### 4. Limitations → Limitations and Future Work
The current "Limitations" section (Section 6) should be expanded into **"Limitations and Future Work"** with proposed future directions. Some starting points:
- Adaptive write-path optimization (reducing curation cost via incremental updates)
- Hybrid retrieval combining BM25 with lightweight embeddings for Tier 2
- Cross-workspace federation for multi-team knowledge sharing
- Learned lifecycle parameters (auto-tuning decay rates and maturity thresholds)
- Benchmark contribution: a new saturation-aware benchmark designed for agent-native memory

## Building the PDF

```bash
# Requires BasicTeX or MacTeX
# Install: brew install --cask basictex
# Then: sudo tlmgr install multirow algorithms algorithmic enumitem float tcolorbox environ trimspaces listings subcaption natbib tabularx

make          # Build PDF
make clean    # Remove build artifacts
```

## File Structure

| File | Description |
|------|-------------|
| `main.tex` | Full paper source (~750 lines) |
| `references.bib` | Bibliography (45+ entries) |
| `Makefile` | Build automation |
| `.gitignore` | Excludes PDF and LaTeX build artifacts |
