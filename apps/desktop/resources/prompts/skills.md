<!--
"## Skills" of the stable prompt (context/prompt-stable.ts skillsSection): the skills fact line; "My main skills" lines
follow it. {{has_knowledge_find}} / {{has_knowledge_open}} = 'yes' when the turn offers that tool. For an own version:
{{skills}} = the index as "- name – description" lines, {{count}} = how many. The section is left out when the agent's
index is empty. <data>/prompts/skills.md replaces this file.
-->
## Skills
Skills exist for most kinds of work – mine and my home project's{{#has_knowledge_find}}: knowledge.find finds the right one by the words of the job{{/has_knowledge_find}}{{#has_knowledge_open}}, knowledge.open loads it before that kind of work{{/has_knowledge_open}}. Other teams share theirs in the public library, rated by those who used them: library.find.
