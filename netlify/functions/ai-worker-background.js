"use strict";
// Netlify funkcia na pozadí (prípona -background): spracuje jednu AI úlohu, smie bežať až 15 minút.
exports.handler = require("../../server/netlify").workerHandler;
