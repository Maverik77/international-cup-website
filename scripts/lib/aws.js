import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, exit } from 'node:process';

const REGION = 'us-east-1';
const PROFILE = 'icup_website_user';
const EXPECTED_ACCOUNT = '792782029232';

const credentials = fromIni({ profile: PROFILE });

export function getClients() {
  const ddb = new DynamoDBClient({ region: REGION, credentials });
  const doc = DynamoDBDocumentClient.from(ddb);
  const sts = new STSClient({ region: REGION, credentials });
  return { ddb, doc, sts };
}

export async function assertAccount() {
  const { sts } = getClients();
  let identity;
  try {
    identity = await sts.send(new GetCallerIdentityCommand({}));
  } catch (err) {
    console.error(`[abort] failed to resolve identity for profile '${PROFILE}': ${err.message}`);
    console.error(`[abort] try: aws sso login --profile default`);
    exit(1);
  }
  console.log(`[identity] account=${identity.Account} arn=${identity.Arn}`);
  if (identity.Account !== EXPECTED_ACCOUNT) {
    console.error(`[abort] wrong account: ${identity.Account} (expected ${EXPECTED_ACCOUNT})`);
    exit(1);
  }
}

export async function confirm(prompt, expected) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(prompt);
  rl.close();
  if (answer.trim() !== expected) {
    console.error(`[abort] confirmation failed (got '${answer}', expected '${expected}')`);
    exit(1);
  }
}

export function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
