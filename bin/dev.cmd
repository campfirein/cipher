@echo off

set BR_ENV=development
node --loader ts-node/esm --no-warnings=ExperimentalWarning "%~dp0\dev" %*
