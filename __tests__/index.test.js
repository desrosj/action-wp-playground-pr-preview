'use strict';

jest.mock('@actions/core', () => {
  const actual = jest.requireActual('@actions/core');
  return { ...actual, setOutput: jest.fn(), setFailed: jest.fn() };
});

const harness = require('./helpers/harness');
const fixtures = require('./fixtures/github-responses');

const BASE_PULL_REQUEST = {
  number: 42,
  title: 'Add cool new feature',
  body: '',
  head: { ref: 'feature-branch', sha: 'abc123' },
  base: { ref: 'main' },
};

const BASE_REPOSITORY = {
  name: 'my-plugin',
  full_name: 'acme/my-plugin',
  owner: { login: 'acme' },
};

let githubApi;
let core;

beforeEach(() => {
  githubApi = harness.resetHarness();
  // Required AFTER resetHarness() (which calls jest.resetModules()), not at
  // this file's top level. A top-level require here would capture a mock
  // instance from a module generation that no longer exists by the time
  // runAction() requires a fresh src/index.js — which would get a brand-new
  // mock generation instead, with its own separate jest.fn() instances that
  // this file's assertions would never see (same class of bug as requiring
  // `undici` at harness.js's top level — see that file's resetHarness()).
  core = require('@actions/core');
});

describe('comment mode', () => {
  it('creates a new comment with an auto-built plugin blueprint when none exists yet', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, []);

    let createdCommentBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/issues/42/comments',
        method: 'POST',
        body: (body) => {
          createdCommentBody = JSON.parse(body);
          return true;
        },
      })
      .reply(201, fixtures.comment({ id: 555, body: 'placeholder' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(createdCommentBody.body).toContain('<!-- wp-playground-preview-comment -->');
    expect(createdCommentBody.body).toContain('### WordPress Playground Preview');

    expect(core.setOutput).toHaveBeenCalledWith('mode', 'comment');
    expect(core.setOutput).toHaveBeenCalledWith('comment-id', '555');
    expect(core.setOutput).toHaveBeenCalledWith(
      'blueprint-json',
      JSON.stringify({
        $schema: 'https://playground.wordpress.net/blueprint-schema.json',
        preferredVersions: { php: '8.2', wp: 'latest' },
        steps: [
          {
            step: 'installPlugin',
            pluginData: {
              resource: 'git:directory',
              url: 'https://github.com/acme/my-plugin.git',
              ref: 'feature-branch',
              path: 'my-plugin',
            },
            options: { activate: true },
          },
        ],
      }),
    );
  });

  it('updates an existing managed comment when its content is stale', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, [
        fixtures.comment({ id: 111, body: '<!-- wp-playground-preview-comment -->\nstale content' }),
      ]);

    let updatedBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/issues/comments/111',
        method: 'PATCH',
        body: (body) => {
          updatedBody = JSON.parse(body);
          return true;
        },
      })
      .reply(200, fixtures.comment({ id: 111, body: 'updated' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(updatedBody.body).toContain('<!-- wp-playground-preview-comment -->');
    expect(updatedBody.body).not.toContain('stale content');
    expect(core.setOutput).toHaveBeenCalledWith('comment-id', '111');
  });

  it('does not call updateComment when the existing comment already matches', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
    });

    // Run once for real to capture the exact managed body the action renders,
    // so the "already up to date" fixture below matches it byte-for-byte.
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, []);
    let firstBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/issues/42/comments',
        method: 'POST',
        body: (body) => {
          firstBody = JSON.parse(body).body;
          return true;
        },
      })
      .reply(201, fixtures.comment({ id: 555, body: 'placeholder' }));
    await harness.runAction();

    // Second run: the existing comment already has that exact body. No
    // PATCH interceptor is registered — disableNetConnect() means an
    // unexpected call would throw and be caught by the action's own
    // error handler, surfacing as setFailed.
    githubApi = harness.resetHarness();
    // Re-require after this mid-test reset, same reason as the top-of-file
    // beforeEach: resetHarness() calls jest.resetModules(), so the `core`
    // captured in beforeEach (before this second reset) is now a stale mock
    // instance the upcoming runAction() call's fresh src/index.js won't
    // write to — expect(core.setFailed)... below would silently check a
    // mock nothing can ever call, always passing regardless of what the
    // action actually does.
    core = require('@actions/core');
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
    });
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, [fixtures.comment({ id: 555, body: firstBody })]);

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('removes the managed description block when switching to comment mode', async () => {
    const prWithManagedBlock = {
      ...BASE_PULL_REQUEST,
      body:
        'Some intro text.\n\n<!-- wp-playground-preview:start -->\n' +
        '<a href="old" target="_blank">old button</a>\n<!-- wp-playground-preview:end -->',
    };
    harness.setEventPayload({ pull_request: prWithManagedBlock, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
    });

    let updatedPrBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/pulls/42',
        method: 'PATCH',
        body: (body) => {
          updatedPrBody = JSON.parse(body);
          return true;
        },
      })
      .reply(200, {});
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, []);
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'POST' })
      .reply(201, fixtures.comment({ id: 999, body: 'placeholder' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(updatedPrBody.body).not.toContain('wp-playground-preview:start');
    expect(updatedPrBody.body).toContain('Some intro text.');
  });
});

describe('append-to-description mode', () => {
  it('inserts the managed block into an empty PR description', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
    });

    let updatedBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/pulls/42',
        method: 'PATCH',
        body: (body) => {
          updatedBody = JSON.parse(body);
          return true;
        },
      })
      .reply(200, {});

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(updatedBody.body.startsWith('<!-- wp-playground-preview:start -->')).toBe(true);
    expect(updatedBody.body).toContain('<!-- wp-playground-preview:end -->');
  });

  it('replaces stale managed content while preserving surrounding text', async () => {
    // The old content must itself look like a button (an "<a " tag whose
    // content mentions "playground") or performDescriptionUpdate treats it
    // as a user placeholder and skips the update instead of replacing it —
    // see the looksLikeButton check in src/description.js (Task 10).
    const prWithStaleBlock = {
      ...BASE_PULL_REQUEST,
      body:
        'Intro.\n\n<!-- wp-playground-preview:start -->\n' +
        '<a href="https://playground.wordpress.net/#OLD_BLUEPRINT" target="_blank">old</a>\n' +
        '<!-- wp-playground-preview:end -->\n\nOutro.',
    };
    harness.setEventPayload({ pull_request: prWithStaleBlock, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
    });

    let updatedBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/pulls/42',
        method: 'PATCH',
        body: (body) => {
          updatedBody = JSON.parse(body);
          return true;
        },
      })
      .reply(200, {});

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(updatedBody.body).toContain('Intro.');
    expect(updatedBody.body).toContain('Outro.');
    expect(updatedBody.body).not.toContain('OLD_BLUEPRINT');
  });

  it('does not call pulls.update when the description is already up to date', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
    });
    let renderedBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/pulls/42',
        method: 'PATCH',
        body: (body) => {
          renderedBody = JSON.parse(body).body;
          return true;
        },
      })
      .reply(200, {});
    await harness.runAction();

    githubApi = harness.resetHarness();
    // Re-require after this mid-test reset — see the identical comment in
    // Task 2's "does not call updateComment when already matching" test for
    // why this is required and what silently breaks without it.
    core = require('@actions/core');
    const prAlreadyUpToDate = { ...BASE_PULL_REQUEST, body: renderedBody };
    harness.setEventPayload({ pull_request: prAlreadyUpToDate, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
    });
    // No PATCH interceptor registered — a real call attempt fails loudly.

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('skips updating when a user placeholder is detected between the markers', async () => {
    const prWithPlaceholder = {
      ...BASE_PULL_REQUEST,
      body:
        '<!-- wp-playground-preview:start -->\n' +
        'See our internal wiki for preview instructions instead.\n' +
        '<!-- wp-playground-preview:end -->',
    };
    harness.setEventPayload({ pull_request: prWithPlaceholder, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
    });
    // No PATCH interceptor registered — a real call attempt fails loudly.

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('skips restoring the button when restore-button-if-removed is false', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'false',
    });
    // BASE_PULL_REQUEST.body has no markers, and restoring is disabled —
    // no PATCH interceptor registered — a real call attempt fails loudly.

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('HTML-escapes interpolated values in a custom template, except the button itself', async () => {
    const prWithSpecialTitle = { ...BASE_PULL_REQUEST, title: `<script>alert('x')</script> & "quotes"` };
    harness.setEventPayload({ pull_request: prWithSpecialTitle, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'append-to-description',
      'plugin-path': 'my-plugin',
      'restore-button-if-removed': 'true',
      'description-template': 'Preview for: {{PR_TITLE}}\n\n{{PLAYGROUND_BUTTON}}',
    });

    githubApi.intercept({ path: '/repos/acme/my-plugin/pulls/42', method: 'PATCH' }).reply(200, {});

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith(
      'rendered-description',
      expect.stringContaining('&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt; &amp; &quot;quotes&quot;'),
    );
  });
});

describe('blueprint construction', () => {
  it('passes a custom blueprint input through unchanged', async () => {
    const customBlueprint = JSON.stringify({ steps: [{ step: 'login', username: 'admin' }] });
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      blueprint: customBlueprint,
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, []);
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'POST' })
      .reply(201, fixtures.comment({ id: 1, body: 'placeholder' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('blueprint-json', customBlueprint);
  });

  it('uses a custom blueprint-url directly instead of building a data: URL', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'blueprint-url': 'https://example.com/my-blueprint.json',
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'GET' })
      .reply(200, []);
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/42/comments', method: 'POST' })
      .reply(201, fixtures.comment({ id: 1, body: 'placeholder' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('blueprint-json', '');
    expect(core.setOutput).toHaveBeenCalledWith(
      'preview-url',
      `https://playground.wordpress.net?blueprint-url=${encodeURIComponent('https://example.com/my-blueprint.json')}`,
    );
  });

  it('fails with a clear error when the custom blueprint is not valid JSON', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      blueprint: '{not valid json',
    });
    // No interceptors registered — validation must fail before any API call.

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Blueprint is not valid JSON'));
  });
});

describe('pr-number input', () => {
  it('fetches PR details from the API when pr-number is provided', async () => {
    harness.setEventPayload({ repository: BASE_REPOSITORY }); // no pull_request in the payload
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
      'pr-number': '99',
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/pulls/99', method: 'GET' })
      .reply(
        200,
        fixtures.pullRequest({
          number: 99,
          title: 'Fetched via API',
          headRef: 'fetched-branch',
          headSha: 'deadbeef',
          baseRef: 'main',
        }),
      );
    githubApi
      .intercept({ path: '/repos/acme/my-plugin/issues/99/comments', method: 'GET' })
      .reply(200, []);
    let createdBody;
    githubApi
      .intercept({
        path: '/repos/acme/my-plugin/issues/99/comments',
        method: 'POST',
        body: (body) => {
          createdBody = JSON.parse(body);
          return true;
        },
      })
      .reply(201, fixtures.comment({ id: 1, body: 'placeholder' }));

    await harness.runAction();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(createdBody).toBeDefined();
    expect(core.setOutput).toHaveBeenCalledWith(
      'blueprint-json',
      expect.stringContaining('"ref":"fetched-branch"'),
    );
  });

  it('fails with a clear error when the pr-number fetch fails', async () => {
    harness.setEventPayload({ repository: BASE_REPOSITORY });
    harness.setInputs({
      'github-token': 'test-token',
      mode: 'comment',
      'plugin-path': 'my-plugin',
      'pr-number': '404',
    });

    githubApi
      .intercept({ path: '/repos/acme/my-plugin/pulls/404', method: 'GET' })
      .reply(404, { message: 'Not Found' });

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch PR #404'));
  });
});

describe('input validation', () => {
  it('fails when mode is missing', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({ 'github-token': 'test-token', 'plugin-path': 'my-plugin' });

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid preview mode'));
  });

  it('fails when mode is invalid', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({ 'github-token': 'test-token', mode: 'carrier-pigeon', 'plugin-path': 'my-plugin' });

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid preview mode'));
  });

  it('fails when none of plugin-path/theme-path/blueprint/blueprint-url is provided', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({ 'github-token': 'test-token', mode: 'comment' });

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('One of `plugin-path`, `theme-path`, `blueprint`, or `blueprint-url` inputs is required'),
    );
  });

  it('fails when github-token is missing', async () => {
    harness.setEventPayload({ pull_request: BASE_PULL_REQUEST, repository: BASE_REPOSITORY });
    harness.setInputs({ mode: 'comment', 'plugin-path': 'my-plugin' });

    await harness.runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('github-token'));
  });
});
