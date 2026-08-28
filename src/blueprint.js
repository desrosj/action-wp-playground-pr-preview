'use strict';

function normalizePath(path) {
  const raw = (path || '').trim();
  if (!raw || raw === '.' || raw === './') {
    return '';
  }
  return raw.replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
}

function sanitizeSlug(value, fallback) {
  if (!value) return fallback;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function inferSlug(path, fallback) {
  const clean = normalizePath(path).split('/').filter(Boolean).pop();
  if (!clean || clean === '.' || clean === '..') return fallback;
  return sanitizeSlug(clean, fallback);
}

function buildAutoBlueprint({ pluginPath, themePath, repoGitUrl, headRef }) {
  const steps = [];

  if (pluginPath) {
    steps.push({
      step: 'installPlugin',
      pluginData: {
        resource: 'git:directory',
        url: repoGitUrl,
        ref: headRef,
        path: normalizePath(pluginPath) || '/',
      },
      options: { activate: true },
    });
  }

  if (themePath) {
    steps.push({
      step: 'installTheme',
      themeData: {
        resource: 'git:directory',
        url: repoGitUrl,
        ref: headRef,
        path: normalizePath(themePath) || '/',
      },
      options: { activate: true },
    });
  }

  return JSON.stringify({
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    preferredVersions: { php: '8.2', wp: 'latest' },
    steps,
  });
}

module.exports = { normalizePath, sanitizeSlug, inferSlug, buildAutoBlueprint };
