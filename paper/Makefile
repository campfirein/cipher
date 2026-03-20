# ByteRover Paper Build
# Usage: make        (build PDF)
#        make clean  (remove build artifacts)
#        make watch  (rebuild on changes — requires fswatch)

MAIN = main
LATEX = pdflatex
BIBTEX = bibtex

.PHONY: all clean watch

all: $(MAIN).pdf

$(MAIN).pdf: $(MAIN).tex references.bib
	$(LATEX) $(MAIN)
	$(BIBTEX) $(MAIN)
	$(LATEX) $(MAIN)
	$(LATEX) $(MAIN)

clean:
	rm -f $(MAIN).{pdf,aux,bbl,blg,log,out,toc,lof,lot,fls,fdb_latexmk,synctex.gz}

watch:
	fswatch -o $(MAIN).tex references.bib | xargs -n1 -I{} make all
