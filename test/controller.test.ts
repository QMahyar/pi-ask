import { describe, expect, it } from "vitest";
import { normalizeQuestionnaire } from "../src/normalize.ts";
import { AskUserController } from "../src/session/controller.ts";
import type { NormalizedChoiceQuestion } from "../src/types.ts";

function choice(options: { recommendation?: string | string[]; multi?: boolean } = {}) {
  return {
    type: "choice",
    id: "c1",
    header: "Pick",
    prompt: "Which one?",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ],
    multi: options.multi ?? false,
    ...(options.recommendation !== undefined ? { recommendation: options.recommendation } : {}),
  };
}

function text(options: { recommendation?: string } = {}) {
  return {
    type: "text",
    id: "t1",
    header: "Notes",
    prompt: "Anything else?",
    ...(options.recommendation !== undefined ? { recommendation: options.recommendation } : {}),
  };
}

function makeController(questions: unknown[]) {
  return new AskUserController(normalizeQuestionnaire({ questions: questions as never }));
}

function choiceQuestion(controller: AskUserController): NormalizedChoiceQuestion {
  return controller.questionnaire.questions[0] as NormalizedChoiceQuestion;
}

describe("AskUserController", () => {
  it("constructor throws on an empty questionnaire", () => {
    expect(() => new AskUserController({ questions: [] })).toThrow(
      "AskUserController requires at least one question.",
    );
  });

  describe("initial state (choice)", () => {
    it("seeds selection from an explicit recommendation", () => {
      const controller = makeController([choice({ recommendation: "b" }), text()]);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      expect(controller.isOptionSelected("c1", "c")).toBe(false);
    });

    it("selects nothing when a single-select has no recommendation", () => {
      const controller = makeController([choice(), text()]);
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
      expect(controller.isOptionSelected("c1", "c")).toBe(false);
    });

    it("seeds multi-select from an array recommendation", () => {
      const controller = makeController([
        choice({ multi: true, recommendation: ["a", "c"] }),
        text(),
      ]);
      expect(controller.isOptionSelected("c1", "a")).toBe(true);
      expect(controller.isOptionSelected("c1", "c")).toBe(true);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
    });
  });

  describe("initial state (text)", () => {
    it("seeds value from a recommendation", () => {
      const controller = makeController([choice(), text({ recommendation: "suggested" })]);
      expect(controller.getTextAnswer("t1")).toBe("suggested");
    });

    it("seeds an empty value without a recommendation", () => {
      const controller = makeController([choice(), text()]);
      expect(controller.getTextAnswer("t1")).toBe("");
    });
  });

  describe("selectChoiceOption", () => {
    it("is exclusive for single-select", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.selectChoiceOption(c, 1);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      controller.selectChoiceOption(c, 2);
      expect(controller.isOptionSelected("c1", "c")).toBe(true);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
    });

    it("clears markedUnanswered when an option is selected", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.markCurrentQuestionUnanswered();
      expect(controller.isQuestionMarkedUnanswered("c1")).toBe(true);
      controller.selectChoiceOption(c, 1);
      expect(controller.isQuestionMarkedUnanswered("c1")).toBe(false);
    });

    it("out-of-bounds index is a no-op and does not deselect the current selection", () => {
      const controller = makeController([choice({ recommendation: "b" })]);
      const c = choiceQuestion(controller);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
      controller.selectChoiceOption(c, 99);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
      controller.selectChoiceOption(c, -1);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
    });
  });

  describe("toggleChoiceOption", () => {
    it("toggles multi-select options and back", () => {
      const controller = makeController([
        choice({ multi: true, recommendation: ["a", "c"] }),
        text(),
      ]);
      const c = choiceQuestion(controller);
      expect(controller.isOptionSelected("c1", "a")).toBe(true);
      controller.toggleChoiceOption(c, 0);
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      controller.toggleChoiceOption(c, 0);
      expect(controller.isOptionSelected("c1", "a")).toBe(true);
    });

    it("behaves like select for non-multi questions", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.toggleChoiceOption(c, 1);
      expect(controller.isOptionSelected("c1", "b")).toBe(true);
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      controller.toggleChoiceOption(c, 2);
      expect(controller.isOptionSelected("c1", "c")).toBe(true);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
    });
  });

  describe("setTextAnswer", () => {
    it("trims whitespace", () => {
      const controller = makeController([choice(), text()]);
      controller.setTextAnswer("t1", "  hello  ");
      expect(controller.getTextAnswer("t1")).toBe("hello");
    });

    it("clears markedUnanswered when non-empty", () => {
      const controller = makeController([text()]);
      controller.setTextAnswer("t1", "x");
      controller.markCurrentQuestionUnanswered();
      expect(controller.isQuestionMarkedUnanswered("t1")).toBe(true);
      controller.setTextAnswer("t1", "y");
      expect(controller.isQuestionMarkedUnanswered("t1")).toBe(false);
    });

    it("keeps markedUnanswered when empty", () => {
      const controller = makeController([text()]);
      controller.setTextAnswer("t1", "x");
      controller.markCurrentQuestionUnanswered();
      expect(controller.isQuestionMarkedUnanswered("t1")).toBe(true);
      controller.setTextAnswer("t1", "   ");
      expect(controller.getTextAnswer("t1")).toBe("");
      expect(controller.isQuestionMarkedUnanswered("t1")).toBe(true);
    });

    it("sanitizes control and bidi characters out of answers", () => {
      const controller = makeController([text()]);
      controller.setTextAnswer("t1", "\u001b[31mred\u202Eevil");
      expect(controller.getTextAnswer("t1")).toBe("[31mredevil");
    });
  });

  describe("markCurrentQuestionUnanswered", () => {
    it("clears all selections on a choice question and preserves comments", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.setQuestionComment("c1", "  note  ");
      controller.setChoiceOptionComment(c, 1, "  opt  ");
      controller.markCurrentQuestionUnanswered();
      expect(controller.isOptionSelected("c1", "a")).toBe(false);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
      expect(controller.isQuestionMarkedUnanswered("c1")).toBe(true);
      expect(controller.getQuestionComment("c1")).toBe("note");
      expect(controller.getOptionComment("c1", "b")).toBe("opt");
    });

    it("clears the value on a text question and preserves comments", () => {
      const controller = makeController([text()]);
      controller.setTextAnswer("t1", "hello");
      controller.setQuestionComment("t1", "qc");
      controller.markCurrentQuestionUnanswered();
      expect(controller.getTextAnswer("t1")).toBe("");
      expect(controller.isQuestionMarkedUnanswered("t1")).toBe(true);
      expect(controller.getQuestionComment("t1")).toBe("qc");
    });
  });

  describe("comments", () => {
    it("trims the form comment and stores undefined for blank", () => {
      const controller = makeController([choice(), text()]);
      controller.setComment("  hi  ");
      expect(controller.comment).toBe("hi");
      controller.setComment("   ");
      expect(controller.comment).toBeUndefined();
    });

    it("tolerates null and undefined comments instead of throwing", () => {
      const controller = makeController([choice()]);
      controller.setComment(null);
      expect(controller.comment).toBeUndefined();
      controller.setComment(undefined);
      expect(controller.comment).toBeUndefined();
    });

    it("trims question comments and stores undefined for blank", () => {
      const controller = makeController([choice(), text()]);
      controller.setQuestionComment("c1", "  hi  ");
      expect(controller.getQuestionComment("c1")).toBe("hi");
      controller.setQuestionComment("c1", "   ");
      expect(controller.getQuestionComment("c1")).toBeUndefined();
    });

    it("trims option comments and stores undefined for blank", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.setChoiceOptionComment(c, 0, "  hi  ");
      expect(controller.getOptionComment("c1", "a")).toBe("hi");
      controller.setChoiceOptionComment(c, 0, "   ");
      expect(controller.getOptionComment("c1", "a")).toBeUndefined();
    });

    it("setChoiceOptionComment with a bad index is a no-op", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.setChoiceOptionComment(c, 99, "x");
      expect(controller.getOptionComment("c1", "a")).toBeUndefined();
      controller.setChoiceOptionComment(c, 99, undefined);
      expect(controller.getOptionComment("c1", "a")).toBeUndefined();
    });

    it("sanitizes control and bidi characters out of comments", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.setComment("\u202Ehi\u202C");
      expect(controller.comment).toBe("hi");
      controller.setQuestionComment("c1", "\u001b[1mbold\u001b[0m");
      expect(controller.getQuestionComment("c1")).toBe("[1mbold[0m");
      controller.setChoiceOptionComment(c, 1, "\u0085weird\u009B");
      expect(controller.getOptionComment("c1", "b")).toBe("weird");
    });
  });

  describe("navigation", () => {
    it("goNext/goBack/goTo are bounds-checked", () => {
      const controller = makeController([choice(), text()]);
      expect(controller.currentIndex).toBe(0);
      expect(controller.goNext()).toBe(true);
      expect(controller.currentIndex).toBe(1);
      expect(controller.goNext()).toBe(false);
      expect(controller.goBack()).toBe(true);
      expect(controller.currentIndex).toBe(0);
      expect(controller.goBack()).toBe(false);
      expect(controller.goTo(1)).toBe(true);
      expect(controller.goTo(2)).toBe(false);
      expect(controller.goTo(-1)).toBe(false);
      expect(controller.currentIndex).toBe(1);
      expect(controller.goTo(0)).toBe(true);
    });

    it("after cancel, navigation and mutations are no-ops", () => {
      const controller = makeController([choice(), text()]);
      const c = choiceQuestion(controller);
      controller.cancel();
      expect(controller.goNext()).toBe(false);
      expect(controller.goBack()).toBe(false);
      expect(controller.goTo(1)).toBe(false);
      controller.selectChoiceOption(c, 1);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
      controller.toggleChoiceOption(c, 1);
      expect(controller.isOptionSelected("c1", "b")).toBe(false);
      controller.setTextAnswer("t1", "x");
      expect(controller.getTextAnswer("t1")).toBe("");
      controller.setChoiceOptionComment(c, 0, "x");
      expect(controller.getOptionComment("c1", "a")).toBeUndefined();
      controller.markCurrentQuestionUnanswered();
      expect(controller.isQuestionMarkedUnanswered("c1")).toBe(false);
    });
  });

  describe("cancel/abort", () => {
    it("cancel is idempotent and stores the interaction result", () => {
      const controller = makeController([choice()]);
      expect(controller.cancel()).toEqual({ kind: "cancel" });
      expect(controller.cancel()).toEqual({ kind: "cancel" });
      expect(controller.getInteractionResult()).toEqual({ kind: "cancel" });
    });

    it("abort is idempotent and stores the interaction result", () => {
      const controller = makeController([choice()]);
      expect(controller.abort()).toEqual({ kind: "abort" });
      expect(controller.abort()).toEqual({ kind: "abort" });
      expect(controller.getInteractionResult()).toEqual({ kind: "abort" });
    });
  });

  describe("outcome", () => {
    it("submitted when every question is answered", () => {
      const controller = makeController([choice({ recommendation: "b" }), text()]);
      controller.setTextAnswer("t1", "  hello  ");
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("submitted");
      expect(outcome.responses[0]?.answer.answered).toBe(true);
      expect(outcome.responses[1]?.answer).toEqual({
        kind: "text",
        answered: true,
        value: "hello",
      });
    });

    it("needs_discussion when a text question is untouched", () => {
      const controller = makeController([choice({ recommendation: "b" }), text()]);
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("needs_discussion");
      expect(outcome.responses[1]?.answer.answered).toBe(false);
    });

    it("needs_discussion for a single-select choice without a recommendation left untouched", () => {
      const controller = makeController([choice()]);
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("needs_discussion");
      expect(outcome.responses[0]?.answer).toEqual({
        kind: "choice",
        answered: false,
        options: [],
      });
    });

    it("a commented-but-unselected option appears with selected: false", () => {
      const controller = makeController([choice()]);
      const c = choiceQuestion(controller);
      controller.markCurrentQuestionUnanswered();
      controller.setChoiceOptionComment(c, 1, "hmm");
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("needs_discussion");
      expect(outcome.responses[0]?.answer).toEqual({
        kind: "choice",
        answered: false,
        options: [{ value: "b", label: "B", selected: false, comment: "hmm" }],
      });
    });

    it("includes the form comment when set and omits it when unset", () => {
      const controller = makeController([choice({ recommendation: "b" }), text()]);
      controller.setTextAnswer("t1", "ok");
      expect(controller.outcome().comment).toBeUndefined();
      controller.setComment("thanks");
      expect(controller.outcome().comment).toBe("thanks");
    });

    it("text value is included when answered and omitted when unanswered", () => {
      const unanswered = makeController([text()]);
      expect(unanswered.outcome().responses[0]?.answer).toEqual({
        kind: "text",
        answered: false,
      });
      const answered = makeController([text()]);
      answered.setTextAnswer("t1", "yes");
      expect(answered.outcome().responses[0]?.answer).toEqual({
        kind: "text",
        answered: true,
        value: "yes",
      });
    });
  });

  describe("kind-mismatch no-ops", () => {
    it("isOptionSelected and getOptionComment on a text question return false/undefined", () => {
      const controller = makeController([text()]);
      expect(controller.isOptionSelected("t1", "a")).toBe(false);
      expect(controller.getOptionComment("t1", "a")).toBeUndefined();
    });

    it("setTextAnswer on a choice question is a no-op", () => {
      const controller = makeController([choice()]);
      controller.setTextAnswer("c1", "x");
      expect(controller.getTextAnswer("c1")).toBe("");
    });
  });

  describe("multi-select deselect-all", () => {
    it("produces needs_discussion when every recommended option is toggled off", () => {
      const controller = makeController([choice({ multi: true, recommendation: ["a", "b"] })]);
      const c = choiceQuestion(controller);
      controller.toggleChoiceOption(c, 0);
      controller.toggleChoiceOption(c, 1);
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("needs_discussion");
      expect(outcome.responses[0]?.answer).toEqual({
        kind: "choice",
        answered: false,
        options: [],
      });
    });
  });

  describe("question comments in the outcome", () => {
    it("includes question comments for choice and text responses", () => {
      const controller = makeController([choice({ recommendation: "a" }), text()]);
      controller.setTextAnswer("t1", "ok");
      controller.setQuestionComment("c1", "think about it");
      controller.setQuestionComment("t1", "scratch that");
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("submitted");
      expect(outcome.responses[0]?.questionComment).toBe("think about it");
      expect(outcome.responses[1]?.questionComment).toBe("scratch that");
    });
  });

  describe("getters", () => {
    it("currentQuestion tracks the navigation position", () => {
      const controller = makeController([choice(), text()]);
      expect(controller.currentQuestion.id).toBe("c1");
      controller.goNext();
      expect(controller.currentQuestion.id).toBe("t1");
    });

    it("isTerminal is false initially and true after cancel or abort", () => {
      const cancelled = makeController([choice()]);
      expect(cancelled.isTerminal).toBe(false);
      cancelled.cancel();
      expect(cancelled.isTerminal).toBe(true);

      const aborted = makeController([choice()]);
      aborted.abort();
      expect(aborted.isTerminal).toBe(true);
    });
  });

  describe("selected + comment serialization", () => {
    it("includes a selected option with its comment in the response", () => {
      const controller = makeController([choice({ recommendation: "b" })]);
      const c = choiceQuestion(controller);
      controller.setChoiceOptionComment(c, 1, "with note");
      const outcome = controller.outcome();
      expect(outcome.outcome).toBe("submitted");
      expect(outcome.responses[0]?.answer).toEqual({
        kind: "choice",
        answered: true,
        options: [{ value: "b", label: "B", selected: true, comment: "with note" }],
      });
    });
  });

  describe("stateFor", () => {
    it("throws for unknown question ids", () => {
      const controller = makeController([choice(), text()]);
      expect(() => controller.getTextAnswer("nope")).toThrow(/Unknown question id "nope"/);
      expect(() => controller.getQuestionComment("nope")).toThrow(/Unknown question id "nope"/);
    });
  });
});
