import { motion } from 'framer-motion';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

interface InjuryAlertsModuleProps {
  alerts: Array<{ injured: InjuryData; replacements: InjuryData[] }>;
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
          className="p-4 bg-red-50 border border-red-100 rounded-lg"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h4 className="font-medium text-red-900">
                  {alert.injured.name} - {alert.injured.injury || 'Injured'}
                </h4>
                <p className="text-sm text-red-700">
                  {alert.injured.position}, {alert.injured.team}
                </p>
                {alert.replacements.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-red-800 mb-1">Suggested replacements:</p>
                    <div className="space-y-1">
                      {alert.replacements.slice(0, 2).map((replacement) => (
                        <div key={replacement.id} className="text-xs text-red-700">
                          {replacement.name} ({replacement.position}, {replacement.team})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
