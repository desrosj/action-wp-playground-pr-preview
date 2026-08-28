'use strict';

const {
  DESCRIPTION_MARKER_START,
  DESCRIPTION_MARKER_END,
  performDescriptionUpdate,
  removeManagedDescriptionBlock,
} = require('../src/description');

function fakeGithub() {
  return { rest: { pulls: { update: jest.fn().mockResolvedValue({}) } } };
}

describe('performDescriptionUpdate', () => {
  // Must look like a button (an "<a " tag mentioning "playground") or the
  // looksLikeButton check in src/description.js treats it as a user
  // placeholder and skips updating — see the "already matches" test below,
  // which relies on this same content being recognized as a real button.
  const BUTTON_HTML = '<a href="https://playground.wordpress.net">button</a>';
  const base = { owner: 'acme', repoName: 'repo', prNumber: 1, renderedDescription: BUTTON_HTML, restoreButtonIfRemoved: true };

  it('inserts the managed block when the description is empty', async () => {
    const github = fakeGithub();
    await performDescriptionUpdate({ github, ...base, currentBody: '' });
    expect(github.rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'repo',
        pull_number: 1,
        body: `${DESCRIPTION_MARKER_START}\n${BUTTON_HTML}\n${DESCRIPTION_MARKER_END}`,
      }),
    );
  });

  it('does nothing when markers are absent and restoreButtonIfRemoved is false', async () => {
    const github = fakeGithub();
    await performDescriptionUpdate({ github, ...base, currentBody: 'plain text', restoreButtonIfRemoved: false });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('skips updating when a non-button user placeholder is found between markers', async () => {
    const github = fakeGithub();
    const currentBody = `${DESCRIPTION_MARKER_START}\nsee the wiki instead\n${DESCRIPTION_MARKER_END}`;
    await performDescriptionUpdate({ github, ...base, currentBody });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('does nothing when the rendered body already matches the current body', async () => {
    const github = fakeGithub();
    const currentBody = `${DESCRIPTION_MARKER_START}\n${BUTTON_HTML}\n${DESCRIPTION_MARKER_END}`;
    await performDescriptionUpdate({ github, ...base, currentBody });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('does nothing when both markers are present but out of order, so the block regex cannot match', async () => {
    const github = fakeGithub();
    // Both markers are present (satisfying the `.includes()` check on both),
    // but END comes before START, so the non-greedy START...END regex has
    // nothing to match — this exercises the `if (match) {}` false branch,
    // after which .replace() is also a no-op and nextBody === currentBody.
    const currentBody = `${DESCRIPTION_MARKER_END}\n${DESCRIPTION_MARKER_START}`;
    await performDescriptionUpdate({ github, ...base, currentBody });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('appends the managed block after existing content when markers are absent', async () => {
    const github = fakeGithub();
    // Distinct from the "description is empty" case above: a non-empty
    // currentBody exercises the truthy branch of the
    // `nextBody = trimmed ? ... : managedBlock` ternary.
    const currentBody = 'Some existing PR description.';
    await performDescriptionUpdate({ github, ...base, currentBody });
    expect(github.rest.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        body: `Some existing PR description.\n\n${DESCRIPTION_MARKER_START}\n${BUTTON_HTML}\n${DESCRIPTION_MARKER_END}`,
      }),
    );
  });
});

describe('removeManagedDescriptionBlock', () => {
  it('strips the managed block when markers are present', async () => {
    const github = fakeGithub();
    const currentBody = `Intro.\n\n${DESCRIPTION_MARKER_START}\n<a>button</a>\n${DESCRIPTION_MARKER_END}`;
    await removeManagedDescriptionBlock({ github, owner: 'acme', repoName: 'repo', prNumber: 1, currentBody });
    const call = github.rest.pulls.update.mock.calls[0][0];
    expect(call.body).toBe('Intro.');
  });

  it('does nothing when markers are absent', async () => {
    const github = fakeGithub();
    await removeManagedDescriptionBlock({ github, owner: 'acme', repoName: 'repo', prNumber: 1, currentBody: 'plain text' });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });

  it('does nothing when both markers are present but out of order, so there is nothing to strip', async () => {
    const github = fakeGithub();
    // Both markers are present (passing the early `.includes()` guard), but
    // END comes before START and there's no trailing whitespace, so the
    // strip regex can't match, .replace() is a no-op, and .trimEnd() leaves
    // the string unchanged — nextBody === currentBody, exercising that
    // branch's false path.
    const currentBody = `${DESCRIPTION_MARKER_END}${DESCRIPTION_MARKER_START}`;
    await removeManagedDescriptionBlock({ github, owner: 'acme', repoName: 'repo', prNumber: 1, currentBody });
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
  });
});
