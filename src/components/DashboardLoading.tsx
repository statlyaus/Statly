export default function DashboardLoading() {
  return (
    <main
      className="min-h-screen bg-[linear-gradient(180deg,#f7f5ef_0%,#f4f1ea_42%,#efebe3_100%)]"
      role="main"
      aria-busy="true"
    >
      <section className="mx-auto max-w-[var(--app-shell-max-width)] px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200/80 bg-white/92 p-5 shadow-[0_22px_70px_-45px_rgba(15,23,42,0.35)] sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                <div className="h-10 w-full max-w-[34rem] animate-pulse rounded bg-slate-200" />
                <div className="h-5 w-full max-w-[40rem] animate-pulse rounded bg-slate-100" />
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-9 w-32 animate-pulse rounded-full border border-slate-200 bg-slate-100"
                  />
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))]">
              <div className="rounded-[1.5rem] bg-slate-950 px-5 py-5">
                <div className="h-3 w-24 animate-pulse rounded bg-white/20" />
                <div className="mt-4 h-7 w-2/3 animate-pulse rounded bg-white/20" />
                <div className="mt-3 h-4 w-5/6 animate-pulse rounded bg-white/15" />
              </div>
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5"
                >
                  <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                  <div className="mt-4 h-6 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="mt-3 h-4 w-5/6 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-full animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <div className="space-y-6">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white/94 p-5 shadow-[0_20px_55px_-42px_rgba(15,23,42,0.38)] backdrop-blur-sm">
                <div className="mb-4 space-y-2">
                  <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
                  <div className="h-7 w-52 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-full max-w-[34rem] animate-pulse rounded bg-slate-100" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.28)]"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2">
                            <div className="h-6 w-24 animate-pulse rounded-full bg-slate-100" />
                            <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
                          </div>
                          <div className="mt-4 h-6 w-56 animate-pulse rounded bg-slate-200" />
                          <div className="mt-2 h-4 w-40 animate-pulse rounded bg-slate-100" />
                          <div className="mt-2 h-4 w-full max-w-[28rem] animate-pulse rounded bg-slate-100" />
                          <div className="mt-4 grid gap-2 md:grid-cols-3">
                            {Array.from({ length: 3 }).map((__, cardIndex) => (
                              <div key={cardIndex} className="rounded-xl bg-slate-50 px-3 py-3">
                                <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
                                <div className="mt-2 h-4 w-24 animate-pulse rounded bg-slate-200" />
                                <div className="mt-2 h-3 w-full animate-pulse rounded bg-slate-100" />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 lg:w-[190px]">
                          <div className="h-10 animate-pulse rounded-xl bg-slate-200" />
                          <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                {Array.from({ length: 2 }).map((_, index) => (
                  <section
                    key={index}
                    className="rounded-[1.5rem] border border-slate-200 bg-white/94 p-5 shadow-[0_20px_55px_-42px_rgba(15,23,42,0.38)] backdrop-blur-sm"
                  >
                    <div className="space-y-2">
                      <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
                      <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </div>
                    <div className="mt-4 space-y-3">
                      {Array.from({ length: 3 }).map((__, rowIndex) => (
                        <div
                          key={rowIndex}
                          className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <aside className="space-y-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <section
                  key={index}
                  className="rounded-[1.5rem] border border-slate-200 bg-white/94 p-5 shadow-[0_20px_55px_-42px_rgba(15,23,42,0.38)] backdrop-blur-sm"
                >
                  <div className="space-y-2">
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                    <div className="h-6 w-36 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {Array.from({ length: 3 }).map((__, rowIndex) => (
                      <div
                        key={rowIndex}
                        className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
                      />
                    ))}
                  </div>
                </section>
              ))}
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
