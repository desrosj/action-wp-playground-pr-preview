'use strict';

function mergeVariables(...maps) {
  return maps.reduce((acc, map) => {
    Object.entries(map || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      acc[String(key).toUpperCase()] = typeof value === 'string' ? value : JSON.stringify(value);
    });
    return acc;
  }, {});
}

function substitute(template, values) {
  if (!template) {
    return '';
  }
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/gi, (match, key) => {
    const upperKey = key.toUpperCase();
    let value = Object.prototype.hasOwnProperty.call(values, upperKey) ? values[upperKey] : '';

    if (upperKey !== 'PLAYGROUND_BUTTON') {
      // Escape HTML entities somewhat naively to prevent the values leaking into HTML syntax elements.
      value = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    return value;
  });
}

module.exports = { mergeVariables, substitute };
