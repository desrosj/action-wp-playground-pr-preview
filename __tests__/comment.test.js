'use strict';

const { performCommentUpdate } = require('../src/comment');

const IDENTIFIER = '<!-- wp-playground-preview-comment -->';

describe('performCommentUpdate', () => {
  const base = { owner: 'acme', repoName: 'repo', prNumber: 1, commentIdentifier: IDENTIFIER, renderedComment: 'body text' };

  it('creates a new comment when none exists yet', async () => {
    const github = {
      paginate: jest.fn().mockResolvedValue([]),
      rest: {
        issues: {
          createComment: jest.fn().mockResolvedValue({ data: { id: 42 } }),
          updateComment: jest.fn(),
        },
      },
    };

    const commentId = await performCommentUpdate({ github, ...base });

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'repo', issue_number: 1, body: `${IDENTIFIER}\nbody text` }),
    );
    expect(commentId).toBe(42);
  });

  it('updates an existing managed comment when its content is stale', async () => {
    const github = {
      paginate: jest.fn().mockResolvedValue([{ id: 7, body: `${IDENTIFIER}\nold text` }]),
      rest: {
        issues: {
          createComment: jest.fn(),
          updateComment: jest.fn().mockResolvedValue({}),
        },
      },
    };

    const commentId = await performCommentUpdate({ github, ...base });

    expect(github.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'repo', comment_id: 7, body: `${IDENTIFIER}\nbody text` }),
    );
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(commentId).toBe(7);
  });

  it('does nothing when the existing comment already matches', async () => {
    const github = {
      paginate: jest.fn().mockResolvedValue([{ id: 7, body: `${IDENTIFIER}\nbody text` }]),
      rest: { issues: { createComment: jest.fn(), updateComment: jest.fn() } },
    };

    const commentId = await performCommentUpdate({ github, ...base });

    expect(github.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(commentId).toBe(7);
  });
});
