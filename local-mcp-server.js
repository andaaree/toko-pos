const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const { exec } = require("child_process");
const util = require("util");

const execPromise = util.promisify(exec);
const STATE_FILE = "./WORKFLOW_STATE.md";

const server = new Server({
  name: "project-orchestrator-mcp",
  version: "1.0.0"
}, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_state_file",
        description: "Reads the current WORKFLOW_STATE.md to determine the next task.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "update_state_file",
        description: "Updates a specific task string in WORKFLOW_STATE.md with a new status.",
        inputSchema: {
          type: "object",
          properties: {
            task_string: { type: "string" },
            new_status: { type: "string", description: "e.g., [x] or [IN PROGRESS]" }
          },
          required: ["task_string", "new_status"]
        }
      },
      {
        name: "execute_local_test",
        description: "Runs a local shell command (e.g. npm test). Returns stdout and stderr.",
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"]
        }
      },
      {
        name: "git_commit_push",
        description: "Stages, commits, and pushes changes to the current branch.",
        inputSchema: {
          type: "object",
          properties: { commit_message: { type: "string" } },
          required: ["commit_message"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "read_state_file":
        const content = fs.readFileSync(STATE_FILE, "utf-8");
        return { content: [{ type: "text", text: content }] };

      case "update_state_file":
        const { task_string, new_status } = request.params.arguments;
        let fileText = fs.readFileSync(STATE_FILE, "utf-8");
        fileText = fileText.replace(task_string, `${new_status} ${task_string.substring(task_string.indexOf(']') + 2)}`);
        fs.writeFileSync(STATE_FILE, fileText);
        return { content: [{ type: "text", text: "State file updated successfully." }] };

      case "execute_local_test":
        const { command } = request.params.arguments;
        try {
          const { stdout, stderr } = await execPromise(command);
          return { content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }] };
        } catch (e) {
          // Returning the error allows the agent to read the failing test output and fix it
          return { content: [{ type: "text", text: `EXECUTION FAILED:\nSTDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}` }] };
        }

      case "git_commit_push":
        const { commit_message } = request.params.arguments;
        const gitCmd = `git add . && git commit -m "${commit_message}" && git push`;
        const { stdout: gitOut } = await execPromise(gitCmd);
        return { content: [{ type: "text", text: `Git successful:\n${gitOut}` }] };

      default:
        throw new Error("Tool not found");
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
run();