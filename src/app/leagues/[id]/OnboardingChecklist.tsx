'use client';

import { useEffect, useState } from 'react';
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

    const leagueId = member?.leagueId;
    const userId = member?.userId;
    if (leagueId && userId) {
      const storageKey = `league-onboarding:${leagueId}:${userId}`;
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!Array.isArray(parsed)) {
            throw new Error(
              'Onboarding data from localStorage is not an array.'
            );
          }
          setTasks(parsed as Task[]);
          return;
        }
      } catch (err) {
        console.warn(
          'Failed to parse onboarding tasks from localStorage',
          err
        );
        localStorage.removeItem(storageKey);
      }
    }

    setTasks(initial);
  }, [member]);

  useEffect(() => {
    const leagueId = member?.leagueId;
    const userId = member?.userId;
    if (!leagueId || !userId) return;
    const storageKey = `league-onboarding:${leagueId}:${userId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(tasks));
    } catch {
      // ignore quota errors
    }
  }, [tasks, member]);

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

