"use strict";
// Netlify funkcia: celé rozhranie /api/*, /_blob/* a /healthz (presmerovania sú v netlify.toml).
exports.handler = require("../../server/netlify").apiHandler;
