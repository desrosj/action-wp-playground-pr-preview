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
