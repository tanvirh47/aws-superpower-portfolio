import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  try {
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const player = body.player || "gk";
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: "motm_" + player },
        UpdateExpression: "SET votes = if_not_exists(votes, :start) + :inc",
        ExpressionAttributeValues: { ":start": 0, ":inc": 1 }
      }));
    } else {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: "attendance" },
        UpdateExpression: "SET count_val = if_not_exists(count_val, :start) + :inc",
        ExpressionAttributeValues: { ":start": 100, ":inc": 1 }
      }));
    }

    const att = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { id: "attendance" } }));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendance: att.Item?.count_val || 101, status: "Match Live on AWS Sydney" })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};