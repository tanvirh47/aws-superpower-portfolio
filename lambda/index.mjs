import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;
const VALID_PLAYERS = new Set(["gk", "cb", "cm", "rw", "st"]);
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean));

function response(statusCode, payload, origin) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return { statusCode, headers, body: JSON.stringify(payload) };
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  if (method === "OPTIONS") return response(204, {}, origin);
  if (!TABLE_NAME) return response(500, { error: "Server configuration error." }, origin);
  if (method !== "GET" && method !== "POST") return response(405, { error: "Method not allowed." }, origin);

  try {
    if (method === "GET") {
      // Reading attendance must not increment it. If no item exists yet, report zero.
      const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { id: "attendance" }, ConsistentRead: true }));
      const attendance = Number.isFinite(result.Item?.count_val) ? result.Item.count_val : 0;
      return response(200, { attendance, status: "Match Live on AWS Sydney" }, origin);
    }

    let body;
    try {
      const rawBody = event?.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString("utf8")
        : (event?.body || "{}");
      body = JSON.parse(rawBody);
    } catch {
      return response(400, { error: "Request body must be valid JSON." }, origin);
    }
    if (body?.action === "attendance") {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: "attendance" },
        UpdateExpression: "SET count_val = if_not_exists(count_val, :start) + :one",
        ExpressionAttributeValues: { ":start": 100, ":one": 1 },
        ReturnValues: "UPDATED_NEW"
      }));
      return response(200, { ok: true, attendance: result.Attributes?.count_val ?? null }, origin);
    }

    const player = body?.player;
    if (typeof player !== "string" || !VALID_PLAYERS.has(player)) {
      return response(400, { error: "Invalid player. Allowed values: gk, cb, cm, rw, st." }, origin);
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: `motm_${player}` },
      UpdateExpression: "SET votes = if_not_exists(votes, :zero) + :one",
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
      ReturnValues: "UPDATED_NEW"
    }));
    const votes = Number.isFinite(result.Attributes?.votes) ? result.Attributes.votes : null;
    return response(200, { ok: true, player, votes, status: "Vote recorded" }, origin);
  } catch (error) {
    // Log diagnostic details in CloudWatch, but never expose raw AWS errors to the browser.
    console.error("Portfolio Lambda request failed", { name: error?.name, message: error?.message });
    return response(500, { error: "The request could not be completed. Please try again." }, origin);
  }
};
