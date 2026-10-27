output "amplify_live_url" {
  value = "https://main.${aws_amplify_app.portfolio.default_domain}"
}

output "lambda_function_url" {
  value = aws_lambda_function_url.stats_url.function_url
}