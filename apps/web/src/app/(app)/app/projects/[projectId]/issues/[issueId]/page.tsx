import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import IssueDetail, { type IssueDetailTab } from "@/components/coworker/issue-detail";
import {
  coworkers,
  projectIssueComments,
  projectIssues,
  projects,
  pullRequestReviews,
  runs,
  type ProjectIssue,
  type ProjectIssueStatus,
  type PullRequestReview,
  type Run,
} from "@/lib/coworker-data";

type ProjectIssuePageProps = {
  params: Promise<{ projectId: string; issueId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const reviewStatusToIssueStatus: Record<PullRequestReview["status"], ProjectIssueStatus> = {
  Reviewing: "In review",
  "Waiting for CI": "In review",
  Approved: "Done",
};

function issueMatches(issue: ProjectIssue, issueId: string): boolean {
  return (
    issue.id === issueId || String(issue.number) === issueId || `issue-${issue.number}` === issueId
  );
}

function findReviewIssue(review: PullRequestReview): ProjectIssue | undefined {
  return (
    projectIssues.find(
      (issue) => issue.projectId === review.projectId && issue.number === review.number,
    ) ??
    projectIssues.find(
      (issue) =>
        issue.projectId === review.projectId && review.branch.includes(`issue-${issue.number}`),
    ) ??
    projectIssues.find(
      (issue) =>
        issue.projectId === review.projectId &&
        review.title.toLowerCase() === issue.title.toLowerCase(),
    )
  );
}

function issueFromReview(review: PullRequestReview, repo: string, run?: Run): ProjectIssue {
  const coworker = coworkers.find((item) => item.id === review.coworkerId);
  const linkedIssue = findReviewIssue(review);

  return {
    id: review.id,
    projectId: review.projectId,
    number: review.number,
    title: review.title,
    body:
      run?.result ??
      "This pull request review is attached to a coworker run and can be inspected from the associated run timeline.",
    status: reviewStatusToIssueStatus[review.status],
    labels: ["pull-request", review.status],
    assignee: coworker?.name ?? "Coworker",
    openedBy: coworker?.name ?? "GitHub",
    opened: run?.started ?? "Earlier today",
    comments: review.status === "Approved" ? 3 : 8,
    updated: run?.started ?? "Earlier today",
    githubUrl: `https://github.com/${repo}/pull/${review.number}`,
    lastComment: run?.result ?? linkedIssue?.lastComment ?? "Pull request review is attached.",
    linkedRunId: run?.id,
  };
}

function findAssociatedRuns(issue: ProjectIssue): Run[] {
  return runs.filter(
    (run) =>
      run.id === issue.linkedRunId ||
      run.branch.includes(`issue-${issue.number}`) ||
      run.title.includes(`#${issue.number}`),
  );
}

function parseIssueDetailTab(value: string | string[] | undefined): IssueDetailTab {
  const tab = Array.isArray(value) ? value[0] : value;

  if (tab === "details" || tab === "comments" || tab === "runs" || tab === "github") {
    return tab;
  }

  return "details";
}

export default async function ProjectIssuePage({
  params,
  searchParams,
}: ProjectIssuePageProps): Promise<ReactElement> {
  const { projectId, issueId } = await params;
  const { tab } = await searchParams;
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const review = pullRequestReviews.find(
    (item) => item.projectId === project.id && item.id === issueId,
  );
  const reviewRun = review ? runs.find((run) => run.branch === review.branch) : undefined;
  const issue =
    projectIssues.find((item) => item.projectId === project.id && issueMatches(item, issueId)) ??
    (review ? issueFromReview(review, project.repo, reviewRun) : undefined);

  if (!issue) {
    notFound();
  }

  const issueComments = projectIssueComments.filter((comment) => comment.issueId === issue.id);
  const associatedRuns = findAssociatedRuns(issue);
  const assignee = coworkers.find((coworker) => coworker.name === issue.assignee);
  const reviewer = coworkers.find((coworker) => coworker.id === project.reviewerCoworkerId);

  return (
    <CoworkerPage variant="workspace" width="full">
      <IssueDetail
        project={project}
        issue={issue}
        comments={issueComments}
        runs={associatedRuns}
        assignee={assignee}
        reviewer={reviewer}
        initialTab={parseIssueDetailTab(tab)}
      />
    </CoworkerPage>
  );
}
