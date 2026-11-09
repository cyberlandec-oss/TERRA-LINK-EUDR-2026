@echo off
rem Doble clic para levantar Terra Link en local (Windows). No cambia la politica de ejecucion del sistema.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar-local.ps1"
