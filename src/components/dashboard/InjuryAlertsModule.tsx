import { motion } from 'framer-motion';
import InjuryAlert from '../InjuryAlert';
import type { Player } from '@/types/players';

interface InjuryAlertsModuleProps {
  alerts: Array<{ injured: Player; replacements: Player[] }>;
  refreshTrigger: number;
}

export default function InjuryAlertsModule({ alerts, refreshTrigger: _refreshTrigger }: InjuryAlertsModuleProps) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h4 className="font-medium text-slate-900 mb-1">All Clear!</h4>
        <p className="text-sm text-slate-600">No injury alerts for your players</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, index) => (
        <motion.div
          key={alert.injured.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <InjuryAlert
            injured={alert.injured}
            replacements={alert.replacements}
          />
        </motion.div>
      ))}
    </div>
  );
}
