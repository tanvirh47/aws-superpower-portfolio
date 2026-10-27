terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# 1. DynamoDB table for attendance and MOTM votes
resource "aws_dynamodb_table" "portfolio_stats" {
  name         = "tanvir-portfolio-match-stats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

# 2. Package the Node.js Lambda function
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/index.mjs"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_iam_role" "lambda_role" {
  name = "tanvir_portfolio_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_logs" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamo_policy" {
  name = "tanvir_lambda_dynamo_policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.portfolio_stats.arn
    }]
  })
}

resource "aws_lambda_function" "stats_api" {
  function_name    = "tanvir-portfolio-match-engine"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # Uncomment to cap cost if the public URL gets hammered.
  # Note: new accounts with a low concurrency quota (10) cannot reserve any.
  # reserved_concurrent_executions = 5

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.portfolio_stats.name
    }
  }
}

resource "aws_lambda_function_url" "stats_url" {
  function_name      = aws_lambda_function.stats_api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type"]
  }
}

# Public access for the function URL (required with authorization_type NONE)
resource "aws_lambda_permission" "url_public" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.stats_api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Newer AWS requirement: also allow InvokeFunction via the function URL.
# Needs a recent aws provider 5.x. If your version rejects the argument, run `terraform init -upgrade`.
resource "aws_lambda_permission" "url_public_invoke" {
  statement_id             = "AllowPublicInvokeViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.stats_api.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# 3. AWS Amplify hosting
resource "aws_amplify_app" "portfolio" {
  name         = "tanvir-superpower-portfolio"
  repository   = var.github_repository
  access_token = var.github_token

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        build:
          commands:
            - echo "Deploying Tanvir Tactical Portfolio..."
      artifacts:
        baseDirectory: site
        files:
          - '**/*'
  EOT
}

resource "aws_amplify_branch" "main" {
  app_id            = aws_amplify_app.portfolio.id
  branch_name       = "main"
  enable_auto_build = true
}
