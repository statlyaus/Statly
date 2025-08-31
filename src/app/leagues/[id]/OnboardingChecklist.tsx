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
    const saved = localStorage.getItem('league-onboarding');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, Task[]>;
        setTasks(parsed[member?.leagueId ?? ''] ?? initial);
        return;
      } catch {
        // ignore
      }
    }
    setTasks(initial);
  }, [member]);

  useEffect(() => {
    if (!member) return;
    const saved = localStorage.getItem('league-onboarding');
    const data = saved ? (JSON.parse(saved) as Record<string, Task[]>) : {};
    data[member.leagueId] = tasks;
    localStorage.setItem('league-onboarding', JSON.stringify(data));
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
              id={task.id}
              type="checkbox"
              checked={task.completed}
              onChange={() => toggle(task.id)}
              className="mr-2 h-4 w-4"
            />
            <label
              htmlFor={task.id}
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

