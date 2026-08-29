'use strict';

async function performCommentUpdate({
  github,
  owner,
  repoName,
  prNumber,
  commentIdentifier,
  renderedComment,
  log = () => {},
}) {
  const managedBody = `${commentIdentifier}\n${renderedComment.trim()}`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo: repoName,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find(
    (comment) => typeof comment.body === 'string' && comment.body.includes(commentIdentifier),
  );

  if (existing) {
    if (existing.body !== managedBody) {
      await github.rest.issues.updateComment({ owner, repo: repoName, comment_id: existing.id, body: managedBody });
      log(`Updated existing preview comment (id: ${existing.id}).`);
    } else {
      log('Preview comment already up to date.');
    }
    return existing.id;
  }

  const created = await github.rest.issues.createComment({ owner, repo: repoName, issue_number: prNumber, body: managedBody });
  log(`Posted new preview comment (id: ${created.data.id}).`);
  return created.data.id;
}

module.exports = { performCommentUpdate };
