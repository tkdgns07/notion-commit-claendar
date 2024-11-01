import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

interface CommitFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface CommitDetail {
  sha: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
  files: CommitFile[];
}

interface BranchOnlyResult {
  branches: string[];
}

const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;
const githubToken = process.env.GITHUB_TOKEN;
const notionUpdateApiUrl = `${process.env.BASE_URL}/api/updatenotioncalendar`;

function getISOTimeFiveMinutesAgo(): string {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return fiveMinutesAgo.toISOString();
}

async function getCommit(includeDetails = true): Promise<CommitDetail[] | BranchOnlyResult> {
  try {
    const since = getISOTimeFiveMinutesAgo();
    const url = `https://api.github.com/repos/${owner}/${repo}/commits`;

    const commitListResponse = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
      },
      params: { since },
    });

    const commits = commitListResponse.data;

    if (!includeDetails) {
      const branchesUrl = `https://api.github.com/repos/${owner}/${repo}/branches`;
      const branchesResponse = await axios.get(branchesUrl, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
        },
      });

      const branches = branchesResponse.data.map((branch: { name: string }) => branch.name);
      return { branches };
    }

    const commitDetails = await Promise.all(
      commits.map(async (commit: { sha: string }) => {
        const commitDetailUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`;
        const commitDetailResponse = await axios.get<CommitDetail>(commitDetailUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
          },
        });

        const { sha, commit: { author, message }, files } = commitDetailResponse.data;

        const formattedFiles = files.map(file => ({
          filename: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        }));

        return {
          sha,
          author: author.name,
          date: author.date,
          message,
          files: formattedFiles,
        };
      })
    );

    return commitDetails;
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

async function updateCommit(commitDetails: CommitDetail[]) {
  try {
    const notionResponse = await axios.post(
      notionUpdateApiUrl,
      commitDetails,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return NextResponse.json({ message: 'Commits processed and sent to Notion API', notionResponse: notionResponse.data, commits: commitDetails }, { status: 200 });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      return NextResponse.json({ error: error.response.statusText }, { status: error.response.status });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!owner || !repo || !githubToken || !notionUpdateApiUrl) {
    return NextResponse.json({ error: 'Environment variables not set correctly.' }, { status: 500 });
  }

  const eventType = req.headers.get('X-GitHub-Event');

  if (eventType === 'push') {
    const commitDetails = await getCommit(true);
    return await updateCommit(commitDetails as CommitDetail[]);
  } else if (eventType === 'getBranch') {
    const branchDetails = await getCommit(false);
    return NextResponse.json(branchDetails, { status: 200 });
  } else {
    return NextResponse.json({ message: 'Event not supported' }, { status: 400 });
  }
}
