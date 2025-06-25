// =============================================================================
// lambda/collect-ai-news/index.ts - メインのAI情報収集Lambda関数
// =============================================================================

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TwitterApi } from 'twitter-api-v2';
import { WebClient, Block, KnownBlock } from '@slack/web-api';
import axios from 'axios';
import Parser from 'rss-parser';

// =============================================================================
// 型定義
// =============================================================================

interface AIContent {
  id: string;
  type: 'twitter' | 'rss' | 'github';
  title: string;
  content: string;
  url: string;
  author?: string;
  timestamp: number;
  metrics?: {
    likes?: number;
    retweets?: number;
    stars?: number;
  };
  source_info?: unknown;
}

interface Config {
  slackBotToken: string;
  twitterBearerToken: string;
  slackChannel: string;
}

// =============================================================================
// クライアント初期化
// =============================================================================

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);
const rssParser = new Parser();

// =============================================================================
// 設定取得
// =============================================================================

async function getConfiguration(): Promise<Config> {
  const command = new GetParametersCommand({
    Names: [
      '/ai-insights-bot/slack-bot-token',
      '/ai-insights-bot/twitter-bearer-token',
      '/ai-insights-bot/slack-channel',
    ],
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);
  const params = response.Parameters ?? [];

  const config: Config = {
    slackBotToken: params.find((p) => p.Name?.includes('slack-bot-token'))?.Value ?? '',
    twitterBearerToken: params.find((p) => p.Name?.includes('twitter-bearer-token'))?.Value ?? '',
    slackChannel: params.find((p) => p.Name?.includes('slack-channel'))?.Value ?? '#ai-news',
  };

  if (!config.slackBotToken || !config.twitterBearerToken) {
    throw new Error('必要な設定パラメータが見つかりません');
  }

  return config;
}

// =============================================================================
// Twitter API クライアント
// =============================================================================

class TwitterClient {
  private client: TwitterApi;

  constructor(bearerToken: string) {
    this.client = new TwitterApi(bearerToken);
  }

  async getLatestAIPosts(): Promise<AIContent[]> {
    const tweets: AIContent[] = [];

    const aiAccounts = [
      'OpenAI',
      'DeepMind',
      'AnthropicAI',
      'ylecun',
      'karpathy',
      'demishassabis',
      'ID_AA_Carmack',
      'jeremyphoward',
      'goodfellow_ian',
      'fchollet',
      'EmilWallner',
      'hardmaru',
      'jackclarkSF',
      'sama',
    ];

    const aiKeywords = ['ChatGPT', 'GPT-4', 'Claude', 'Gemini', 'LLM', 'AGI'];

    try {
      // 1. 重要アカウントのタイムライン取得
      for (const username of aiAccounts.slice(0, 5)) {
        // API制限を考慮して5アカウントまで
        try {
          const user = await this.client.v2.userByUsername(username);
          if (!user.data) continue;

          const userTweets = await this.client.v2.userTimeline(user.data.id, {
            max_results: 5,
            'tweet.fields': ['created_at', 'public_metrics', 'context_annotations'],
            exclude: ['retweets', 'replies'],
          });

          for (const tweet of userTweets.data.data || []) {
            if (this.isAIRelated(tweet.text)) {
              tweets.push({
                id: `twitter_${tweet.id}`,
                type: 'twitter',
                title: `@${username}`,
                content: tweet.text,
                url: `https://twitter.com/${username}/status/${tweet.id}`,
                author: username,
                timestamp: new Date(tweet.created_at ?? Date.now()).getTime(),
                metrics: {
                  likes: tweet.public_metrics?.like_count ?? 0,
                  retweets: tweet.public_metrics?.retweet_count ?? 0,
                },
              });
            }
          }

          // API制限対策
          await this.sleep(1000);
        } catch (error) {
          console.error(`Twitter API エラー (${username}):`, error);
        }
      }

      // 2. キーワード検索
      for (const keyword of aiKeywords.slice(0, 2)) {
        // 2キーワードまで
        try {
          const searchResults = await this.client.v2.search(`"${keyword}" -is:retweet lang:en`, {
            max_results: 10,
            'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
            'user.fields': ['username', 'verified'],
            expansions: ['author_id'],
          });

          const users = searchResults.includes?.users || [];
          interface TwitterUser {
            id: string;
            username: string;
            verified?: boolean;
          }

          const userMap = users.reduce(
            (map, user) => {
              map[user.id] = user;
              return map;
            },
            {} as Record<string, TwitterUser>
          );

          for (const tweet of searchResults.data.data || []) {
            const author = tweet.author_id ? userMap[tweet.author_id] : undefined;
            if (author && (author.verified || (tweet.public_metrics?.like_count ?? 0) > 20)) {
              tweets.push({
                id: `twitter_search_${tweet.id}`,
                type: 'twitter',
                title: `@${author.username}`,
                content: tweet.text,
                url: `https://twitter.com/${author.username}/status/${tweet.id}`,
                author: author.username,
                timestamp: new Date(tweet.created_at ?? Date.now()).getTime(),
                metrics: {
                  likes: tweet.public_metrics?.like_count ?? 0,
                  retweets: tweet.public_metrics?.retweet_count ?? 0,
                },
              });
            }
          }

          await this.sleep(1000);
        } catch (error) {
          console.error(`Twitter検索エラー (${keyword}):`, error);
        }
      }
    } catch (error) {
      console.error('Twitter API 全般エラー:', error);
    }

    // 重複除去とソート
    const uniqueTweets = this.removeDuplicates(tweets);
    return uniqueTweets.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  }

  private isAIRelated(text: string): boolean {
    const aiKeywords = [
      'AI',
      'artificial intelligence',
      'machine learning',
      'deep learning',
      'neural network',
      'GPT',
      'LLM',
      'ChatGPT',
      'Claude',
      'Gemini',
      'transformer',
      'AGI',
      'alignment',
      'safety',
      'reinforcement learning',
    ];

    const lowerText = text.toLowerCase();
    return aiKeywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
  }

  private removeDuplicates(tweets: AIContent[]): AIContent[] {
    const seen = new Set();
    return tweets.filter((tweet) => {
      const key = tweet.content.substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// RSS パーサー
// =============================================================================

class RSSClient {
  async getLatestArticles(): Promise<AIContent[]> {
    const articles: AIContent[] = [];
    const rssFeeds = [
      'https://openai.com/blog/rss.xml',
      'https://deepmind.google/discover/blog/rss.xml',
      'https://www.anthropic.com/news/rss',
    ];

    for (const feedUrl of rssFeeds) {
      try {
        const feed = await rssParser.parseURL(feedUrl);

        for (const item of (feed.items ?? []).slice(0, 3)) {
          if (item.link && item.title) {
            articles.push({
              id: `rss_${Buffer.from(item.link).toString('base64').substring(0, 10)}`,
              type: 'rss',
              title: item.title,
              content: item.contentSnippet ?? item.content ?? '',
              url: item.link,
              author: feed.title ?? 'Unknown',
              timestamp: new Date(item.pubDate ?? Date.now()).getTime(),
            });
          }
        }
      } catch (error) {
        console.error(`RSS解析エラー (${feedUrl}):`, error);
      }
    }

    return articles.sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
  }
}

// =============================================================================
// GitHub Trending
// =============================================================================

async function getGitHubTrending(): Promise<AIContent[]> {
  try {
    interface GitHubRepo {
      id: number;
      name: string;
      description: string | null;
      html_url: string;
      owner: {
        login: string;
      };
      updated_at: string;
      stargazers_count: number;
      language: string | null;
      forks_count: number;
    }

    interface GitHubSearchResponse {
      items: GitHubRepo[];
    }

    const response = await axios.get<GitHubSearchResponse>(
      'https://api.github.com/search/repositories?q=topic:artificial-intelligence&sort=stars&order=desc&per_page=5'
    );

    return response.data.items.map((repo) => ({
      id: `github_${repo.id}`,
      type: 'github' as const,
      title: repo.name,
      content: repo.description ?? '',
      url: repo.html_url,
      author: repo.owner.login,
      timestamp: new Date(repo.updated_at).getTime(),
      metrics: {
        stars: repo.stargazers_count,
      },
      source_info: {
        language: repo.language,
        forks: repo.forks_count,
      },
    }));
  } catch (error) {
    console.error('GitHub API エラー:', error);
    return [];
  }
}

// =============================================================================
// 重複チェック（DynamoDB）
// =============================================================================

class DeduplicationService {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  async filterNewContent(content: AIContent[]): Promise<AIContent[]> {
    const newContent: AIContent[] = [];

    for (const item of content) {
      const exists = await this.checkIfExists(item.id);
      if (!exists) {
        newContent.push(item);
      }
    }

    return newContent;
  }

  private async checkIfExists(sourceId: string): Promise<boolean> {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'source_id = :sid',
        ExpressionAttributeValues: {
          ':sid': sourceId,
        },
        Limit: 1,
      });

      const result = await dynamoClient.send(command);
      return (result.Items?.length ?? 0) > 0;
    } catch (error) {
      console.error('重複チェックエラー:', error);
      return false; // エラー時は投稿を許可
    }
  }

  async saveProcessedContent(content: AIContent[]): Promise<void> {
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + 30 * 24 * 60 * 60; // 30日後にTTL

    for (const item of content) {
      try {
        const command = new PutCommand({
          TableName: this.tableName,
          Item: {
            source_id: item.id,
            timestamp: now,
            source_type: item.type,
            title: item.title,
            url: item.url,
            ttl,
          },
        });

        await dynamoClient.send(command);
      } catch (error) {
        console.error('履歴保存エラー:', error);
      }
    }
  }
}

// =============================================================================
// Slack クライアント
// =============================================================================

class SlackClient {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  async postAINews(content: AIContent[], channel: string): Promise<void> {
    const blocks = this.formatMessage(content);

    try {
      await this.client.chat.postMessage({
        channel,
        blocks,
        text: `🤖 AI情報まとめ - ${content.length}件の新着情報`,
      });

      console.log(`Slack投稿成功: ${content.length}件`);
    } catch (error) {
      console.error('Slack投稿エラー:', error);
      throw error;
    }
  }

  private formatMessage(content: AIContent[]): (Block | KnownBlock)[] {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 AI情報まとめ',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📅 ${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} | ${content.length}件の新着情報`,
          },
        ],
      },
      {
        type: 'divider',
      },
    ];

    const twitterContent = content.filter((c) => c.type === 'twitter');
    const rssContent = content.filter((c) => c.type === 'rss');
    const githubContent = content.filter((c) => c.type === 'github');

    // Twitter セクション
    if (twitterContent.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🐦 X (Twitter) からの注目ツイート*',
        },
      });

      twitterContent.forEach((item) => {
        const metrics = item.metrics
          ? `❤️ ${item.metrics.likes} | 🔄 ${item.metrics.retweets}`
          : '';
        const truncatedContent =
          item.content.length > 140 ? `${item.content.substring(0, 140)}...` : item.content;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${item.title}*\n${truncatedContent}\n<${item.url}|ツイートを見る> ${metrics ? `| ${metrics}` : ''}`,
          },
        });
      });

      blocks.push({ type: 'divider' });
    }

    // RSS セクション
    if (rssContent.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📰 最新記事*',
        },
      });

      rssContent.forEach((item) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${item.url}|${item.title}>*\n${item.content.substring(0, 100)}...`,
          },
        });
      });

      blocks.push({ type: 'divider' });
    }

    // GitHub セクション
    if (githubContent.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⭐ GitHub Trending*',
        },
      });

      githubContent.forEach((item) => {
        const language = (item.source_info as { language?: string })?.language ?? 'Unknown';
        const stars = item.metrics?.stars ?? 0;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${item.url}|${item.title}>* (⭐${stars})\n${item.content}\n_Language: ${language}_`,
          },
        });
      });
    }

    return blocks;
  }
}

// =============================================================================
// メインハンドラー
// =============================================================================

export const handler: APIGatewayProxyHandler = async (
  event,
  context
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();

  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'AI情報収集開始',
      requestId: context.awsRequestId,
      event: 'api-gateway',
    })
  );

  try {
    // 設定取得
    const config = await getConfiguration();

    // データ収集
    const [tweets, articles, repos] = await Promise.all([
      new TwitterClient(config.twitterBearerToken).getLatestAIPosts(),
      new RSSClient().getLatestArticles(),
      getGitHubTrending(),
    ]);

    const allContent = [...tweets, ...articles, ...repos];

    console.log(
      JSON.stringify({
        level: 'INFO',
        message: 'データ収集完了',
        counts: {
          twitter: tweets.length,
          rss: articles.length,
          github: repos.length,
          total: allContent.length,
        },
      })
    );

    // 重複チェック
    const tableName = process.env.POST_HISTORY_TABLE;
    if (!tableName) {
      throw new Error('POST_HISTORY_TABLE environment variable is not set');
    }
    const deduplicationService = new DeduplicationService(tableName);
    const newContent = await deduplicationService.filterNewContent(allContent);

    if (newContent.length > 0) {
      // Slack投稿
      const slackClient = new SlackClient(config.slackBotToken);
      await slackClient.postAINews(newContent, config.slackChannel);

      // 履歴保存
      await deduplicationService.saveProcessedContent(newContent);

      console.log(
        JSON.stringify({
          level: 'INFO',
          message: 'Slack投稿完了',
          newItemsCount: newContent.length,
          processingTime: Date.now() - startTime,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          level: 'INFO',
          message: '新しい情報なし',
          totalItemsChecked: allContent.length,
        })
      );
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'AI情報収集完了',
        data: {
          totalCollected: allContent.length,
          newItems: newContent.length,
          processingTimeMs: Date.now() - startTime,
        },
      }),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: '処理エラー',
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      })
    );

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: context.awsRequestId,
      }),
    };
  }
};
