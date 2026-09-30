# syntax=docker/dockerfile:1
#
# Business Expense Deductibility Checker — Airbase deployment image.
#
# Two-stage build:
#   1. converter  — Python + openpyxl reads Deductibility.xlsx and writes data.json
#   2. final      — nginx serves the static site with data.json baked in
#
# The team workflow is unchanged: edit Deductibility.xlsx, push, Airbase rebuilds.
# SheetJS is no longer shipped to the browser — the conversion happens here.
#
# Airbase requirements honoured:
#   - Base image is gdssingapore/airbase:nginx-1.28
#   - Container runs as the non-root `app` user (UID 999) — already the
#     default in the base image; reasserted at the end of this file
#   - Every COPY uses --chown=app:app
#
# Why the nginx config is baked in at build time (not via /etc/nginx/templates):
#   The standard nginx Docker entrypoint that envsubsts templates from
#   /etc/nginx/templates/ → /etc/nginx/conf.d/ at runtime needs write access
#   to conf.d. As the `app` user we don't have that, so the substitution
#   silently fails. Instead we copy the final config in at build time. The
#   listen port is hardcoded in deploy/default.conf — keep it in sync with
#   `port` in airbase.json.
#

# ---------- Stage 1: convert Excel → JSON ----------
FROM python:3.12-slim AS converter

WORKDIR /build
RUN pip install --no-cache-dir openpyxl
COPY Deductibility.xlsx convert.py ./
RUN python3 convert.py

# ---------- Stage 2: final nginx image ----------
FROM gdssingapore/airbase:nginx-1.28

# Site assets.
COPY --chown=app:app index.html app.js styles.css logo.png \
     /usr/share/nginx/html/

# JSON data file produced by the converter stage.
COPY --chown=app:app --from=converter /build/data.json \
     /usr/share/nginx/html/data.json

# Server config (overwrites the default that ships with the base image).
COPY --chown=app:app deploy/default.conf /etc/nginx/conf.d/default.conf

USER app
