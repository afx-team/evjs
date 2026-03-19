export default function (plop) {
  plop.setGenerator("skill", {
    description: "Generate a new AI Agent Skill",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Skill name (kebab-case, e.g. add-server-transport):",
      },
      {
        type: "input",
        name: "description",
        message: "Short description of what this skill teaches the agent:",
      },
    ],
    actions: [
      {
        type: "add",
        path: ".agent/skills/{{name}}/SKILL.md",
        templateFile: "plop-templates/skill.md.hbs",
      },
    ],
  });
}
