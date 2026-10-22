export const showHelp = (): void => {
  console.log(`
KeyHarbor

Usage:
  keyharbor [--vault=<name>] [--env=<name>] <command> [options]

Commands:
  run --project=<name> <command>    Run command with environment variables
  get <project> <key>               Get a secret value
  set <project> <key> <value>       Set a secret value
  create <project>                  Create a new project (succeeds if it already exists)
  list                              List all projects
  environments <project>            List the Project's Environments (metadata only)
  vaults                            List all vaults
  mcp                               Start the local MCP v2 stdio server
  agent --project=<name> --key=<key> --origin=https://api.example.com -- <command> [args]
                                    Run one command with a scoped approved HTTPS proxy
  help                              Show this help message

Options:
  --vault=<name>                    Specify vault (default: System)
  --env=<name>                      Select an Environment (default: Project default)
  --auth-header=<header>            Agent mode credential header (default: Authorization)
  --auth-prefix=<prefix>            Agent mode header prefix (empty for raw API keys)

  KeyHarbor options are only parsed before "--". Everything after "--" is
  forwarded to the child command untouched.

Examples:
  keyharbor run --project=myapp --env=dev -- npm start
  keyharbor get myapp API_KEY --env=prod
  keyharbor get myapp API_KEY
  keyharbor set myapp API_KEY "sk-1234567890" --env=dev
  keyharbor create myapp
  keyharbor list
  keyharbor environments myapp
  keyharbor --vault="Work" list
  keyharbor --vault="Work" get api API_KEY
  keyharbor vaults
  keyharbor mcp
  keyharbor agent --project=myapp --key=API_KEY --origin=https://api.example.com -- npm start
`);
};
