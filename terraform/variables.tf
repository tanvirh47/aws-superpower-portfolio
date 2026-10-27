variable "aws_region" {
  default = "ap-southeast-2"
}

variable "github_repository" {
  description = "Full GitHub repo URL (e.g., https://github.com/username/portfolio)"
  type        = string
}

variable "github_token" {
  description = "GitHub Personal Access Token for AWS Amplify to pull your repo"
  type        = string
  sensitive   = true
}