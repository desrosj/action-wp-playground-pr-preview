'use strict';

/**
 * Minimal hand-rolled GitHub API response fixtures, scoped to only the
 * fields src/index.js actually reads. If a Dependabot bump to
 * @actions/github/@octokit/* changes a shape these fixtures rely on,
 * check against @octokit/plugin-rest-endpoint-methods's generated
 * RestEndpointMethodTypes for the endpoint in question.
 */

function comment({ id, login = 'github-actions[bot]', body }) {
  return { id, user: { login }, body };
}

function pullRequest({ number, title, body = '', headRef, headSha, baseRef, owner = 'acme', repo = 'my-plugin' }) {
  return {
    number,
    title,
    body,
    head: { ref: headRef, sha: headSha },
    base: { ref: baseRef, repo: { owner: { login: owner }, name: repo } },
  };
}

module.exports = { comment, pullRequest };
