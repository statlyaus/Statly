'use client';

import { useEffect, useState, useRef } from 'react';
import type { LeagueMember } from '@/types/leagues';

interface Task {
  id: string;
  label: string;
  completed: boolean;
}

interface Props {
  member?: LeagueMember;
}

export default function OnboardingChecklist({ member }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const memberRef = useRef(member);
  useEffect(() => {
    memberRef.current = member;
  }, [member]);

  useEffect(() => {
    const initial: Task[] = [
      {
        id: 'team-name',
        label: 'Set your team name',
        completed: Boolean(member?.teamName),
      },
      {
        id: 'review-rules',
        label: 'Review league rules',
        completed: false,
      },
    ];
    if (!member) {
      setTasks(initial);
      return;
    }
    const leagueId = member.leagueId;
    const userId = member.userId || 'anon';
    const storageKey = `league-onboarding:${leagueId}:${userId}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setTasks(JSON.parse(saved) as Task[]);
        return;
      }
    } catch (error) {
      console.error('Failed to parse onboarding tasks from localStorage:', error);
    }
    setTasks(initial);
  }, [member]);

  useEffect(() => {
    const m = memberRef.current;
    if (!m) return;
    const storageKey = `league-onboarding:${m.leagueId}:${m.userId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(tasks));
    } catch {
      // ignore quota errors
    }
  }, [tasks]);

  const toggle = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  if (!member) return null;

  return (
    <div className="mb-6 p-4 bg-white border rounded-lg">
      <h2 className="text-lg font-semibold mb-3">Getting Started</h2>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center">
            <input
              id={`${member.leagueId}-${task.id}`}
              type="checkbox"
              checked={task.completed}
              onChange={() => toggle(task.id)}
              className="mr-2 h-4 w-4"
            />
            <label
              htmlFor={`${member.leagueId}-${task.id}`}
              className={task.completed ? 'line-through text-gray-500' : ''}
            >
              {task.label}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

