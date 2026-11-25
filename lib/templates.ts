export interface StageTemplate {
  title: string;
  instructions: string;
  questions: { text: string; required: boolean; heading?: string; options?: string[] }[];
  tags: string[];
  contributionTypes?: string[];
  /** "individual": each person submits each answer on its own (no group submission). Default "group". */
  submitMode?: "group" | "individual";
}
export interface Template {
  key: string;
  label: string;
  description: string;
  stages: StageTemplate[];
}

const AGREE = ["Agree", "Disagree"];

const blankStage = (n: number): StageTemplate => ({ title: `Part ${n}`, instructions: "", questions: [], tags: [] });

/** Neutral, optional starting points. Facilitators can rename and rewrite everything. */
export const TEMPLATES: Template[] = [
  { key: "blank", label: "Blank (Part 1, 2, 3)", description: "Neutral stages with no questions.", stages: [blankStage(1), blankStage(2), blankStage(3)] },
  {
    key: "discussion",
    label: "Discussion",
    description: "Share views, respond to others, and reach a group position.",
    stages: [
      { title: "Part 1: Initial views", instructions: "Share your own view before discussing with the group.", questions: [{ text: "What is your view on the topic, and why?", required: true }], tags: ["Claim", "Reason", "Example", "Question"] },
      { title: "Part 2: Group discussion", instructions: "Respond to ideas from your group.", questions: [{ text: "Where do you agree or disagree with your group, and why?", required: true }], tags: ["Agree", "Disagree", "Question", "Evidence"] },
      { title: "Part 3: Group position", instructions: "Record what the group can agree on, and what remains open.", questions: [{ text: "What is your group's position, and what is still unresolved?", required: true }], tags: ["Position", "Open question"] },
    ],
  },
  {
    key: "inquiry",
    label: "Inquiry",
    description: "Plan an inquiry, record what you find, and explain it.",
    stages: [
      { title: "Part 1: Plan", instructions: "Describe what you want to find out and how.", questions: [{ text: "What question will you investigate, and how?", required: true }], tags: ["Question", "Prediction", "Method"] },
      { title: "Part 2: Gather", instructions: "Record what you observe or collect.", questions: [{ text: "What did you observe or collect?", required: true }], tags: ["Observation", "Data"] },
      { title: "Part 3: Explain", instructions: "Use your evidence to answer the question.", questions: [{ text: "What does the evidence suggest, and how sure are you?", required: true }], tags: ["Evidence", "Explanation", "Limitation"] },
    ],
  },
  {
    key: "case_analysis",
    label: "Case analysis",
    description: "Analyse a case, weigh options, and recommend.",
    stages: [
      { title: "Part 1: Understand the case", instructions: "Identify the key facts and issues.", questions: [{ text: "What are the key facts and issues?", required: true }], tags: ["Fact", "Issue", "Assumption"] },
      { title: "Part 2: Options", instructions: "Propose and weigh options.", questions: [{ text: "What options exist, and what are their strengths and risks?", required: true }], tags: ["Option", "Strength", "Risk"] },
      { title: "Part 3: Recommend", instructions: "Agree a recommendation with reasons.", questions: [{ text: "What do you recommend, and why?", required: true }], tags: ["Recommendation", "Reasoning"] },
    ],
  },
  {
    key: "reflection",
    label: "Reflection",
    description: "Describe an experience, interpret it, and plan what to do next.",
    stages: [
      { title: "Part 1: Describe", instructions: "Describe what happened, without judging it yet.", questions: [{ text: "What happened?", required: true }], tags: ["Description", "Feeling"] },
      { title: "Part 2: Interpret", instructions: "Offer possible explanations.", questions: [{ text: "What might explain it? What else could explain it?", required: true }], tags: ["Interpretation", "Alternative"] },
      { title: "Part 3: Next steps", instructions: "Decide what you will do differently.", questions: [{ text: "What will you do next, and what will you look for?", required: true }], tags: ["Learning", "Action"] },
    ],
  },
  {
    key: "project_planning",
    label: "Project planning",
    description: "Set goals, plan tasks and risks, and agree a timeline.",
    stages: [
      { title: "Part 1: Goals", instructions: "Agree what the project must achieve.", questions: [{ text: "What are the goals and how will you know they are met?", required: true }], tags: ["Goal", "Measure"] },
      { title: "Part 2: Plan", instructions: "Break the work into tasks and risks.", questions: [{ text: "What tasks, resources and risks do you foresee?", required: true }], tags: ["Task", "Resource", "Risk"] },
      { title: "Part 3: Timeline", instructions: "Agree who does what, and by when.", questions: [{ text: "Who does what, and by when?", required: true }], tags: ["Milestone", "Owner"] },
    ],
  },
  {
    key: "post_box",
    label: "Post-box",
    description: "Judge statements (Agree or Disagree) with reasons, see the class results, reflect on each station, then reflect openly.",
    stages: [
      {
        title: "Part 1: Post-box statements",
        instructions: "Read each statement. Choose Agree or Disagree, write your reason, then submit that statement. Submit each statement on its own as you go. Your group can see your answer; the class sees only the totals when your facilitator shows them.",
        questions: [1, 2, 3, 4].map((n) => ({ heading: `Statement ${n}`, text: `Edit this text to write statement ${n}.`, required: false, options: AGREE })),
        tags: ["Evidence", "Example", "Experience", "Question"],
        contributionTypes: ["text"],
        submitMode: "individual",
      },
      {
        title: "Part 2: Station reflections",
        instructions: "Reflect on each station you visited, and submit each station's reflection on its own. Refer to your group's reasons from Part 1 where it helps.",
        questions: [1, 2, 3, 4].map((n) => ({ heading: `Station ${n}`, text: "What did you notice at this station, and how did it change or confirm your thinking?", required: false })),
        tags: ["Noticing", "Changed my mind", "Confirmed", "Still unsure"],
        contributionTypes: ["text", "image"],
        submitMode: "individual",
      },
      {
        title: "Part 3: Open reflection",
        instructions: "Share anything you want to take away from the activity: ideas, questions, or next steps.",
        questions: [],
        tags: [],
      },
    ],
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key);
