// =============================================================================
// lambda/process-and-post/index.ts - 週次サマリー処理Lambda関数
// =============================================================================

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { WebClient, Block, KnownBlock } from '@slack/web-api';

// =============================================================================
// 型定義
// =============================================================================

interface Config {
  slackBotToken: string;
  slackChannel: string;
}

interface StoredPost {
  source_id: string;
  timestamp: number;
  source_type: 'twitter' | 'rss' | 'github';
  title: string;
  url: string;
}

// =============================================================================
// クライアント初期化
// =============================================================================

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);

// =============================================================================
// 設定取得
// =============================================================================

async function getConfiguration(): Promise<Config> {
  const command = new GetParametersCommand({
    Names: ['/ai-insights-bot/slack-bot-token', '/ai-insights-bot/slack-channel'],
    WithDecryption: true,
  });

  const response = await ssmClient.send(command);
  const params = response.Parameters ?? [];

  const config: Config = {
    slackBotToken: params.find((p) => p.Name?.includes('slack-bot-token'))?.Value ?? '',
    slackChannel: params.find((p) => p.Name?.includes('slack-channel'))?.Value ?? '#ai-news',
  };

  if (!config.slackBotToken) {
    throw new Error('Slack Bot Token が見つかりません');
  }

  return config;
}

// =============================================================================
// 週次データ取得
// =============================================================================

async function getWeeklyPosts(): Promise<StoredPost[]> {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  try {
    const command = new ScanCommand({
      TableName: process.env.POST_HISTORY_TABLE,
      FilterExpression: '#ts > :oneWeekAgo',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':oneWeekAgo': oneWeekAgo,
      },
    });

    const response = await dynamoClient.send(command);
    return (response.Items ?? []) as StoredPost[];
  } catch (error) {
    console.error('週次データ取得エラー:', error);
    return [];
  }
}

// =============================================================================
// サマリー作成
// =============================================================================

function createWeeklySummary(posts: StoredPost[]): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [];

  // ヘッダー
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 AI週次サマリー',
    },
  });

  // 概要
  const twitterCount = posts.filter((p) => p.source_type === 'twitter').length;
  const rssCount = posts.filter((p) => p.source_type === 'rss').length;
  const githubCount = posts.filter((p) => p.source_type === 'github').length;

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*今週の投稿数:* ${posts.length}件\n` +
        `• Twitter: ${twitterCount}件\n` +
        `• ブログ/ニュース: ${rssCount}件\n` +
        `• GitHub: ${githubCount}件`,
    },
  });

  blocks.push({ type: 'divider' });

  // ソース別トップ投稿
  const categories = [
    { type: 'twitter' as const, emoji: '🐦', title: 'Twitter ハイライト' },
    { type: 'rss' as const, emoji: '📰', title: 'ブログ/ニュース ハイライト' },
    { type: 'github' as const, emoji: '⭐', title: 'GitHub トレンド' },
  ];

  for (const category of categories) {
    const categoryPosts = posts
      .filter((p) => p.source_type === category.type)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);

    if (categoryPosts.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${category.emoji} ${category.title}*`,
        },
      });

      for (const post of categoryPosts) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• <${post.url}|${post.title}>`,
          },
        });
      }

      blocks.push({ type: 'divider' });
    }
  }

  // フッター
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Generated on ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}_`,
      },
    ],
  });

  return blocks;
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
      message: '週次サマリー処理開始',
      requestId: context.awsRequestId,
      event,
    })
  );

  try {
    // 設定取得
    const config = await getConfiguration();

    // 週次データ取得
    const weeklyPosts = await getWeeklyPosts();

    if (weeklyPosts.length === 0) {
      console.log(
        JSON.stringify({
          level: 'INFO',
          message: '今週の投稿なし',
        })
      );

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: '今週の投稿はありませんでした',
          postsCount: 0,
        }),
      };
    }

    // サマリー作成
    const summaryBlocks = createWeeklySummary(weeklyPosts);

    // Slack投稿
    const slack = new WebClient(config.slackBotToken);
    await slack.chat.postMessage({
      channel: config.slackChannel,
      blocks: summaryBlocks,
      text: `📊 AI週次サマリー - ${weeklyPosts.length}件の投稿`,
    });

    console.log(
      JSON.stringify({
        level: 'INFO',
        message: '週次サマリー投稿完了',
        postsCount: weeklyPosts.length,
        processingTime: Date.now() - startTime,
      })
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: '週次サマリーを投稿しました',
        postsCount: weeklyPosts.length,
        breakdown: {
          twitter: weeklyPosts.filter((p) => p.source_type === 'twitter').length,
          rss: weeklyPosts.filter((p) => p.source_type === 'rss').length,
          github: weeklyPosts.filter((p) => p.source_type === 'github').length,
        },
      }),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: '週次サマリー処理エラー',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
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
        error: '週次サマリー処理中にエラーが発生しました',
      }),
    };
  }
};
