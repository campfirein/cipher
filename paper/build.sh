#!/bin/bash
export PATH="/Library/TeX/texbin:/usr/bin:$PATH"
cd "$(dirname "$0")"

pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1
bibtex main > /dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1
pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1

if [ -f main.pdf ]; then
  echo "OK: main.pdf ($(du -h main.pdf | cut -f1 | xargs))"
else
  echo "FAIL: check main.log"
  exit 1
fi
