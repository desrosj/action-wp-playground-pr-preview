'use strict';

const { normalizePath, sanitizeSlug, inferSlug, buildAutoBlueprint } = require('../src/blueprint');

describe('normalizePath', () => {
  it('strips a leading ./ and surrounding slashes', () => {
    expect(normalizePath('./themes/foo/')).toBe('themes/foo');
    expect(normalizePath('/themes/foo')).toBe('themes/foo');
  });

  it('treats "." and "./" and empty as the repo root', () => {
    expect(normalizePath('.')).toBe('');
    expect(normalizePath('./')).toBe('');
    expect(normalizePath('')).toBe('');
  });
});

describe('sanitizeSlug', () => {
  it('lowercases and replaces invalid characters with dashes', () => {
    expect(sanitizeSlug('My Cool Plugin!', 'fallback')).toBe('my-cool-plugin');
  });

  it('falls back when the value is empty or sanitizes to nothing', () => {
    expect(sanitizeSlug('', 'fallback')).toBe('fallback');
    expect(sanitizeSlug('!!!', 'fallback')).toBe('fallback');
  });
});

describe('inferSlug', () => {
  it('uses the last path segment as the slug', () => {
    expect(inferSlug('plugins/my-plugin', 'fallback')).toBe('my-plugin');
  });

  it('falls back for "." or ".." or an empty path', () => {
    expect(inferSlug('.', 'fallback')).toBe('fallback');
    expect(inferSlug('', 'fallback')).toBe('fallback');
  });
});

describe('buildAutoBlueprint', () => {
  const base = { repoGitUrl: 'https://github.com/acme/repo.git', headRef: 'my-branch' };

  it('builds an installPlugin step when only pluginPath is given', () => {
    const blueprint = JSON.parse(buildAutoBlueprint({ ...base, pluginPath: 'my-plugin', themePath: '' }));
    expect(blueprint.steps).toEqual([
      {
        step: 'installPlugin',
        pluginData: {
          resource: 'git:directory',
          url: base.repoGitUrl,
          ref: base.headRef,
          path: 'my-plugin',
        },
        options: { activate: true },
      },
    ]);
  });

  it('builds an installTheme step when only themePath is given', () => {
    const blueprint = JSON.parse(buildAutoBlueprint({ ...base, pluginPath: '', themePath: 'my-theme' }));
    expect(blueprint.steps).toEqual([
      {
        step: 'installTheme',
        themeData: {
          resource: 'git:directory',
          url: base.repoGitUrl,
          ref: base.headRef,
          path: 'my-theme',
        },
        options: { activate: true },
      },
    ]);
  });

  it('builds both steps when both paths are given', () => {
    const blueprint = JSON.parse(
      buildAutoBlueprint({ ...base, pluginPath: 'my-plugin', themePath: 'my-theme' }),
    );
    expect(blueprint.steps).toHaveLength(2);
  });

  it('builds an empty steps array when neither path is given', () => {
    const blueprint = JSON.parse(buildAutoBlueprint({ ...base, pluginPath: '', themePath: '' }));
    expect(blueprint.steps).toEqual([]);
  });

  it('falls back to "/" when pluginPath or themePath normalizes to the repo root', () => {
    // normalizePath('/') strips both slashes down to '', so `path:
    // normalizePath(pluginPath) || '/'` must fall through to the '/'
    // default — exercising that branch for both installPlugin and
    // installTheme steps.
    const blueprint = JSON.parse(buildAutoBlueprint({ ...base, pluginPath: '/', themePath: '/' }));
    expect(blueprint.steps[0].pluginData.path).toBe('/');
    expect(blueprint.steps[1].themeData.path).toBe('/');
  });

  it('always includes the fixed preferredVersions and $schema', () => {
    const blueprint = JSON.parse(buildAutoBlueprint({ ...base, pluginPath: 'p', themePath: '' }));
    expect(blueprint.$schema).toBe('https://playground.wordpress.net/blueprint-schema.json');
    expect(blueprint.preferredVersions).toEqual({ php: '8.2', wp: 'latest' });
  });
});
