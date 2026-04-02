# ByteRover: Agent-Native Memory Through LLM-Curated Hierarchical Context

Research paper for [ByteRover](https://www.byterover.dev/) - an agent-native memory architecture where the LLM itself curates, structures, and retrieves knowledge through a hierarchical Context Tree, requiring zero external infrastructure.

All benchmarks are run using the production `byterover-cli` codebase in this repository - no separate research prototype.

## Results

We evaluate on two long-term conversational memory benchmarks:

- **LoCoMo** - ultra-long conversations (~20K tokens, 35 sessions) testing single-hop, multi-hop, temporal, and open-domain retrieval.
- **LongMemEval-S** - large-scale benchmark (23,867 docs, ~48 sessions per question) testing 6 memory abilities including knowledge update, temporal reasoning, and multi-session synthesis.

**LoCoMo** - 96.1% overall accuracy (1,982 questions, 272 docs).

**LongMemEval-S** - 92.8% overall accuracy (500 questions, 23,867 docs).

All metrics are LLM-as-Judge accuracy (%).

## Building the PDF

```bash
# Requires BasicTeX or MacTeX
# Install: brew install --cask basictex
# Then: sudo tlmgr install multirow algorithms algorithmic enumitem float tcolorbox environ trimspaces listings subcaption natbib tabularx

bash build.sh    # Build PDF
make clean       # Remove build artifacts
```

## File Structure

| File | Description |
|------|-------------|
| `main.tex` | Full paper source (~1,300 lines) |
| `references.bib` | Bibliography (32 entries) |
| `build.sh` | Build script (pdflatex + bibtex) |
| `Makefile` | Build automation |
| `.gitignore` | Excludes PDF and LaTeX build artifacts |
