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
});
