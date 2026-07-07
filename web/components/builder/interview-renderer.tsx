'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, SkipForward, X } from 'lucide-react';
import { useOrchestrationStore } from '@/stores/orchestration';
import type { InterviewQuestion, InterviewAnswer } from '@/lib/conversation-types';

interface InterviewRendererProps {
  onComplete: (answers: InterviewAnswer[]) => void;
}

export default function InterviewRenderer({ onComplete }: InterviewRendererProps) {
  const interviewState = useOrchestrationStore((s) => s.interviewState);
  const answerQuestion = useOrchestrationStore((s) => s.answerInterviewQuestion);
  const skipQuestion = useOrchestrationStore((s) => s.skipInterviewQuestion);
  const cancelInterview = useOrchestrationStore((s) => s.cancelInterview);
  const completeInterview = useOrchestrationStore((s) => s.completeInterview);

  if (!interviewState) return null;

  const { questions, currentIndex, answers } = interviewState;
  const currentQuestion = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;
  const isDone = currentIndex >= questions.length;

  // Interview complete -- fire callback
  if (isDone) {
    // Use setTimeout to avoid updating state during render
    setTimeout(() => {
      completeInterview();
      onComplete(answers);
    }, 0);
    return null;
  }

  return (
    <div className="p-4 bg-white border-t border-neutral-100">
      {/* Progress dots */}
      <div className="flex items-center gap-1 mb-3">
        {questions.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < currentIndex
                ? 'bg-teal-600'
                : i === currentIndex
                ? 'bg-teal-400'
                : 'bg-neutral-200'
            }`}
          />
        ))}
      </div>

      {/* Step indicator */}
      <div className="text-[10px] text-neutral-400 uppercase tracking-wider mb-1.5">
        Question {currentIndex + 1} of {questions.length}
      </div>

      {/* Question with animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentQuestion.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <QuestionInput
            question={currentQuestion}
            isLast={isLast}
            onAnswer={(answer) => {
              answerQuestion(answer);
            }}
            onSkip={skipQuestion}
          />
        </motion.div>
      </AnimatePresence>

      {/* Cancel link */}
      <div className="flex justify-end mt-2">
        <button
          onClick={cancelInterview}
          className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer"
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ============================================
// QUESTION INPUT
// ============================================

function QuestionInput({
  question,
  isLast,
  onAnswer,
  onSkip,
}: {
  question: InterviewQuestion;
  isLast: boolean;
  onAnswer: (answer: InterviewAnswer) => void;
  onSkip: () => void;
}) {
  const [textValue, setTextValue] = useState('');
  const [selectValue, setSelectValue] = useState('');
  const [multiValues, setMultiValues] = useState<string[]>([]);
  const [checkValue, setCheckValue] = useState(false);

  function handleSubmit() {
    let value: string | string[] | boolean;
    switch (question.type) {
      case 'text':
        value = textValue;
        break;
      case 'select':
        value = selectValue;
        break;
      case 'multiselect':
        value = multiValues;
        break;
      case 'checkbox':
        value = checkValue;
        break;
    }
    onAnswer({
      questionId: question.id,
      label: question.label,
      value,
    });
  }

  const canSubmit = (() => {
    switch (question.type) {
      case 'text':
        return textValue.trim().length > 0;
      case 'select':
        return selectValue.length > 0;
      case 'multiselect':
        return multiValues.length > 0;
      case 'checkbox':
        return true;
    }
  })();

  return (
    <div>
      <label className="text-sm font-medium text-neutral-800 block mb-2">
        {question.label}
      </label>

      {question.type === 'text' && (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Type your answer..."
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900/10"
          autoFocus
        />
      )}

      {question.type === 'select' && question.options && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((opt) => (
            <button
              key={opt}
              onClick={() => setSelectValue(selectValue === opt ? '' : opt)}
              className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                selectValue === opt
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {question.type === 'multiselect' && question.options && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((opt) => {
            const selected = multiValues.includes(opt);
            return (
              <button
                key={opt}
                onClick={() =>
                  setMultiValues(
                    selected
                      ? multiValues.filter((v) => v !== opt)
                      : [...multiValues, opt],
                  )
                }
                className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
                }`}
              >
                {selected && <Check size={10} className="inline mr-1" />}
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {question.type === 'checkbox' && (
        <button
          onClick={() => setCheckValue(!checkValue)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <div
            className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${
              checkValue
                ? 'bg-teal-600 border-teal-600'
                : 'bg-white border-neutral-300'
            }`}
          >
            {checkValue && <Check size={10} className="text-white" />}
          </div>
          <span className="text-xs text-neutral-700">Yes</span>
        </button>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-1 px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLast ? (
            <>
              <Check size={12} />
              Finish
            </>
          ) : (
            <>
              <ArrowRight size={12} />
              Next
            </>
          )}
        </button>
        <button
          onClick={onSkip}
          className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer"
        >
          <SkipForward size={12} />
          Skip
        </button>
      </div>
    </div>
  );
}
