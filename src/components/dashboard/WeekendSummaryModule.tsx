import WeekendSummary from '../WeekendSummary';

interface WeekendSummaryModuleProps {
  refreshTrigger: number;
}

export default function WeekendSummaryModule({
  refreshTrigger: _refreshTrigger,
}: WeekendSummaryModuleProps) {
  return (
    <div className="h-full">
      <WeekendSummary />
    </div>
  );
}
