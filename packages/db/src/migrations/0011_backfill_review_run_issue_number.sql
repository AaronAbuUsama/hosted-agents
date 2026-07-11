-- Backfill issue_number on review runs created before issue #54 (QA-B4). Review
-- runs (worker_role = 'code_review') never stored the issue their PR closed, so
-- the issue detail's Runs block could not show them. Recover the issue number
-- from the stored Coder head branch `coder/issue-<n>-<slug>`, mirroring
-- parseCoderIssueBranch: only a purely-numeric segment between `coder/issue-` and
-- the next `-` is accepted. Human-PR reviews (any other head ref) stay NULL.
UPDATE `agent_run`
SET `issue_number` = CAST(
  substr(
    substr(`pull_request_head_ref`, 13),
    1,
    instr(substr(`pull_request_head_ref`, 13), '-') - 1
  ) AS INTEGER
)
WHERE `issue_number` IS NULL
  AND `worker_role` = 'code_review'
  AND `pull_request_head_ref` LIKE 'coder/issue-%-%'
  AND substr(substr(`pull_request_head_ref`, 13), 1, instr(substr(`pull_request_head_ref`, 13), '-') - 1) GLOB '[0-9]*'
  AND substr(substr(`pull_request_head_ref`, 13), 1, instr(substr(`pull_request_head_ref`, 13), '-') - 1) NOT GLOB '*[^0-9]*';
