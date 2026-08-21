#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { fromIni } from '@aws-sdk/credential-providers';
import {
    CreateTableCommand,
    DescribeTableCommand,
    ResourceNotFoundException,
    waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
    IAMClient,
    CreateRoleCommand,
    GetRoleCommand,
    AttachRolePolicyCommand,
    PutRolePolicyCommand,
    NoSuchEntityException,
} from '@aws-sdk/client-iam';
import {
    LambdaClient,
    CreateFunctionCommand,
    GetFunctionCommand,
    UpdateFunctionCodeCommand,
    UpdateFunctionConfigurationCommand,
    AddPermissionCommand,
    waitUntilFunctionActive,
    waitUntilFunctionUpdated,
    ResourceConflictException,
} from '@aws-sdk/client-lambda';
import {
    APIGatewayClient,
    GetResourcesCommand,
    CreateResourceCommand,
    PutMethodCommand,
    PutIntegrationCommand,
    PutMethodResponseCommand,
    PutIntegrationResponseCommand,
    CreateDeploymentCommand,
} from '@aws-sdk/client-api-gateway';
import { CloudFormationClient, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { getClients, assertAccount, sleep } from './lib/aws.js';

const REGION = 'us-east-1';
const ACCOUNT_ID = '792782029232';
const TABLE_NAME = 'icup-availability-2026-prod';
const ROLE_NAME = 'icup-availability-lambda-role';
const SUBMIT_FN = 'icup-submit-availability';
const GET_FN = 'icup-get-availability';
const STACK_NAME = 'icup-pairings-prod';
const API_STAGE = 'prod';
const SENDER_EMAIL = 'noreply@lansdowne-international-cup.com';
const NOTIFY_EMAIL = 'erikwagner77@gmail.com,ash@cavlog.com,tim_pearce36@hotmail.com';
const PROD_PASSWORD_FILE = resolve(homedir(), '.icup-admin-passwords/prod-2026-08-20.txt');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AWS_PROFILE = 'icup_website_user';
const credentials = fromIni({ profile: AWS_PROFILE });

const iam = new IAMClient({ region: REGION, credentials });
const lambda = new LambdaClient({ region: REGION, credentials });
const apigw = new APIGatewayClient({ region: REGION, credentials });
const cfn = new CloudFormationClient({ region: REGION, credentials });

async function main() {
    await assertAccount();
    await precheck();
    await createTable();
    const roleArn = await createRole();
    await sleep(10000); // IAM propagation delay before Lambda can assume the role
    await packageAndDeployLambdas(roleArn);
    const { apiId } = await wireApiGateway();
    await deployApi(apiId);
    await verify(apiId);
    console.log('\n[ok] availability setup complete');
    console.log(`  POST/GET https://${apiId}.execute-api.${REGION}.amazonaws.com/${API_STAGE}/availability`);
}

async function precheck() {
    console.log('\n=== precheck ===');
    if (!existsSync(PROD_PASSWORD_FILE)) {
        throw new Error(`missing ${PROD_PASSWORD_FILE} — cannot set ADMIN_PASSWORD env var on getAvailability Lambda`);
    }
    const pwStat = statSync(PROD_PASSWORD_FILE);
    if ((pwStat.mode & 0o077) !== 0) {
        console.warn(`[warn] ${PROD_PASSWORD_FILE} is world/group-readable — chmod 600 recommended`);
    }
    const submitDir = resolve(REPO_ROOT, 'lambda/submitAvailability');
    const getDir = resolve(REPO_ROOT, 'lambda/getAvailability');
    for (const d of [submitDir, getDir]) {
        if (!existsSync(resolve(d, 'index.js'))) throw new Error(`missing ${resolve(d, 'index.js')}`);
        if (!existsSync(resolve(d, 'package.json'))) throw new Error(`missing ${resolve(d, 'package.json')}`);
    }
    console.log('  [OK] password file present, Lambda dirs present');
}

async function createTable() {
    const { ddb } = getClients();
    try {
        await ddb.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
        console.log(`\n=== ${TABLE_NAME} already exists — skip create ===`);
        return;
    } catch (err) {
        if (!(err instanceof ResourceNotFoundException)) throw err;
    }
    console.log(`\n=== create ${TABLE_NAME} ===`);
    await ddb.send(new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
    }));
    await waitUntilTableExists({ client: ddb, maxWaitTime: 120 }, { TableName: TABLE_NAME });
    console.log('  [OK] created');
}

async function createRole() {
    console.log(`\n=== IAM role ${ROLE_NAME} ===`);
    let existing;
    try {
        existing = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
        console.log('  [OK] role already exists');
    } catch (err) {
        if (!(err instanceof NoSuchEntityException)) throw err;
    }

    if (!existing) {
        const trust = {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        };
        const res = await iam.send(new CreateRoleCommand({
            RoleName: ROLE_NAME,
            AssumeRolePolicyDocument: JSON.stringify(trust),
            Description: 'Availability form Lambda role — narrow DDB + SES only',
        }));
        existing = res;
        console.log('  [OK] role created');

        await iam.send(new AttachRolePolicyCommand({
            RoleName: ROLE_NAME,
            PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        }));
        console.log('  [OK] AWSLambdaBasicExecutionRole attached');
    }

    // Idempotent PutRolePolicy — always sets the inline policy to the intended version.
    const inline = {
        Version: '2012-10-17',
        Statement: [
            {
                Sid: 'AvailabilityTable',
                Effect: 'Allow',
                Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan'],
                Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}`,
            },
            {
                Sid: 'SendMail',
                Effect: 'Allow',
                Action: ['ses:SendEmail'],
                Resource: '*',
            },
        ],
    };
    await iam.send(new PutRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyName: 'availability-inline',
        PolicyDocument: JSON.stringify(inline),
    }));
    console.log('  [OK] inline policy set');

    return existing.Role.Arn;
}

async function packageAndDeployLambdas(roleArn) {
    const adminPassword = readFileSync(PROD_PASSWORD_FILE, 'utf8').trim();

    await deployLambda({
        name: SUBMIT_FN,
        dir: resolve(REPO_ROOT, 'lambda/submitAvailability'),
        roleArn,
        env: {
            AVAILABILITY_TABLE: TABLE_NAME,
            NOTIFY_EMAIL,
            SENDER_EMAIL,
        },
    });

    await deployLambda({
        name: GET_FN,
        dir: resolve(REPO_ROOT, 'lambda/getAvailability'),
        roleArn,
        env: {
            AVAILABILITY_TABLE: TABLE_NAME,
            ADMIN_PASSWORD: adminPassword,
        },
    });
}

async function deployLambda({ name, dir, roleArn, env }) {
    console.log(`\n=== Lambda ${name} ===`);
    console.log(`  installing deps in ${dir}`);
    execSync('npm install --production --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
    const zipPath = `/tmp/${name}.zip`;
    execSync(`rm -f ${zipPath} && cd ${dir} && zip -qr ${zipPath} .`, { stdio: 'inherit' });

    let exists = false;
    try {
        await lambda.send(new GetFunctionCommand({ FunctionName: name }));
        exists = true;
    } catch (err) {
        if (err.name !== 'ResourceNotFoundException') throw err;
    }

    const zipBuf = readFileSync(zipPath);

    if (!exists) {
        console.log('  creating…');
        await lambda.send(new CreateFunctionCommand({
            FunctionName: name,
            Runtime: 'nodejs18.x',
            Role: roleArn,
            Handler: 'index.handler',
            Code: { ZipFile: zipBuf },
            Timeout: 15,
            MemorySize: 256,
            Environment: { Variables: env },
        }));
        await waitUntilFunctionActive({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  [OK] created');
    } else {
        console.log('  updating code…');
        await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zipBuf }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  updating configuration…');
        await lambda.send(new UpdateFunctionConfigurationCommand({
            FunctionName: name,
            Environment: { Variables: env },
            Runtime: 'nodejs18.x',
            Handler: 'index.handler',
            Timeout: 15,
            MemorySize: 256,
        }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  [OK] updated');
    }
}

async function wireApiGateway() {
    console.log('\n=== API Gateway wiring ===');
    const stackRes = await cfn.send(new ListStackResourcesCommand({ StackName: STACK_NAME }));
    const apiSummary = (stackRes.StackResourceSummaries || []).find((r) => r.ResourceType === 'AWS::ApiGateway::RestApi');
    if (!apiSummary) throw new Error(`could not find RestApi in stack ${STACK_NAME}`);
    const apiId = apiSummary.PhysicalResourceId;
    console.log(`  REST API id: ${apiId}`);

    const resourcesRes = await apigw.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }));
    const root = (resourcesRes.items || []).find((r) => r.path === '/');
    if (!root) throw new Error('no root resource on REST API');
    let availability = (resourcesRes.items || []).find((r) => r.path === '/availability');

    if (!availability) {
        console.log('  creating /availability resource');
        availability = await apigw.send(new CreateResourceCommand({
            restApiId: apiId, parentId: root.id, pathPart: 'availability',
        }));
    } else {
        console.log('  /availability resource already exists');
    }

    await ensureMethod({ apiId, resourceId: availability.id, method: 'POST', fnName: SUBMIT_FN });
    await ensureMethod({ apiId, resourceId: availability.id, method: 'GET', fnName: GET_FN });
    await ensureOptionsMethod({ apiId, resourceId: availability.id });

    return { apiId, resourceId: availability.id };
}

async function ensureMethod({ apiId, resourceId, method, fnName }) {
    const fnArn = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${fnName}`;
    console.log(`  [${method}] wiring to ${fnName}`);
    try {
        await apigw.send(new PutMethodCommand({
            restApiId: apiId, resourceId, httpMethod: method,
            authorizationType: 'NONE', apiKeyRequired: false,
        }));
    } catch (err) {
        if (err.name !== 'ConflictException') throw err;
    }
    await apigw.send(new PutIntegrationCommand({
        restApiId: apiId, resourceId, httpMethod: method,
        type: 'AWS_PROXY', integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${fnArn}/invocations`,
    }));
    // Grant API Gateway permission to invoke the Lambda (idempotent — catch on already-exists)
    try {
        await lambda.send(new AddPermissionCommand({
            FunctionName: fnName,
            StatementId: `apigw-${method}-availability`,
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com',
            SourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${apiId}/*/${method}/availability`,
        }));
    } catch (err) {
        if (!(err instanceof ResourceConflictException)) throw err;
    }
}

async function ensureOptionsMethod({ apiId, resourceId }) {
    console.log('  [OPTIONS] mock integration for CORS preflight');
    try {
        await apigw.send(new PutMethodCommand({
            restApiId: apiId, resourceId, httpMethod: 'OPTIONS',
            authorizationType: 'NONE', apiKeyRequired: false,
        }));
    } catch (err) {
        if (err.name !== 'ConflictException') throw err;
    }
    await apigw.send(new PutMethodResponseCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS', statusCode: '200',
        responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
        },
    }));
    await apigw.send(new PutIntegrationCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS',
        type: 'MOCK',
        requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }));
    await apigw.send(new PutIntegrationResponseCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS', statusCode: '200',
        responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Admin-Password'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
            'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
        responseTemplates: { 'application/json': '' },
    }));
}

async function deployApi(apiId) {
    console.log('\n=== deploy API stage ===');
    await apigw.send(new CreateDeploymentCommand({
        restApiId: apiId, stageName: API_STAGE,
        description: 'availability form: initial deploy',
    }));
    console.log('  [OK] deployed to stage prod');
}

async function verify(apiId) {
    console.log('\n=== verify ===');
    const url = `https://${apiId}.execute-api.${REGION}.amazonaws.com/${API_STAGE}/availability`;
    // OPTIONS should return 200
    const optionsRes = await fetch(url, { method: 'OPTIONS' });
    console.log(`  OPTIONS ${url} → ${optionsRes.status}`);
    // GET with wrong password should return 401
    const getRes = await fetch(url, { method: 'GET', headers: { 'X-Admin-Password': 'not-the-password' } });
    console.log(`  GET (wrong pw) → ${getRes.status} (expect 401)`);
    if (getRes.status !== 401) throw new Error(`getAvailability did not enforce auth: ${getRes.status}`);
    console.log('  [OK] endpoint reachable and auth-enforced');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error('[fatal]', err);
        process.exit(1);
    });
}
