# Changelog

## 1.2.0

- Add one versioned Developer Environment Context shared by `Copy for LLM → Agent context` and MCP, so both paths report the same bounded environment snapshot.
- Add the read-only MCP tools `GetDeveloperEnvironmentContext` and `GetEnvironmentDoctor`. The former returns the full context in Markdown and JSON; the latter returns Environment Doctor checks and prepared suggestions without running commands.
- Document the new context and tools in the MCP guide, architecture guide, and localized READMEs. The MCP catalog now contains 42 tools.
