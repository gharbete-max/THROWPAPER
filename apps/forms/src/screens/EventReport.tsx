import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toCsv, type ExportColumn } from '@tp/shared/forms';
import { client } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { formatDateTime, useT } from '../lib/i18n.js';

interface Attendee {
  submissionId: string;
  reference: string;
  name: string;
  email: string | null;
  locale: string;
  revoked: boolean;
  checkedInAt: string | null;
}

interface Attendance {
  registered: number;
  checkedIn: number;
  noShow: number;
  revoked: number;
  byHour: Array<{ hour: string; count: number }>;
  attendees: Attendee[];
}

/**
 * The attendee list and the no-show list.
 *
 * Not the report builder — `SPEC-forms.md` §5 is A9. These are the two lists the door and the
 * organiser actually need, and the no-show one is what somebody wants at 10am the next day.
 */
export function EventReport() {
  const t = useT();
  const { id: eventId } = useParams();
  const { locale, user } = useSession();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [onlyNoShow, setOnlyNoShow] = useState(false);

  const load = useCallback(() => {
    if (!eventId) return;
    client
      .attendance(eventId)
      .then(setAttendance)
      .catch(() => setAttendance(null));
  }, [eventId]);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    const all = attendance?.attendees ?? [];
    return onlyNoShow ? all.filter((a) => !a.checkedInAt && !a.revoked) : all;
  }, [attendance, onlyNoShow]);

  function statusOf(attendee: Attendee): string {
    if (attendee.revoked) return t('attendance.status.revoked');
    return attendee.checkedInAt ? t('attendance.status.arrived') : t('attendance.status.expected');
  }

  /** Reuses 3c's CSV writer, so the BOM and the formula guard come along unchanged. */
  function exportCsv() {
    const columns: ExportColumn[] = [
      { key: 'reference', header: t('attendance.column.reference'), type: 'text' },
      { key: 'name', header: t('attendance.column.name'), type: 'text' },
      { key: 'email', header: t('attendance.column.email'), type: 'text' },
      { key: 'status', header: t('attendance.column.status'), type: 'text' },
      { key: 'checkedInAt', header: t('attendance.column.checkedInAt'), type: 'date' },
    ];

    const csv = toCsv(
      columns,
      rows.map((attendee) => ({ ...attendee, status: statusOf(attendee) })),
    );

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = onlyNoShow ? 'no-shows.csv' : 'attendees.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function revoke(attendee: Attendee) {
    if (!window.confirm(t('events.archiveConfirm'))) return;
    await client.revokeSubmission(attendee.submissionId);
    load();
  }

  if (!attendance) return <p className="muted">{t('app.loading')}</p>;

  return (
    <section className="stack">
      <header className="row row--between">
        <h1>{t('attendance.title')}</h1>
        <div className="row">
          <Link className="button" to={`/events/${eventId}/check-in`}>
            {t('attendance.openCheckIn')}
          </Link>
          <button className="button button--quiet" onClick={exportCsv}>
            {t('attendance.exportCsv')}
          </button>
        </div>
      </header>

      <div className="row stats">
        <Stat label={t('attendance.registered')} value={attendance.registered} />
        <Stat label={t('attendance.checkedIn')} value={attendance.checkedIn} />
        <Stat label={t('attendance.noShow')} value={attendance.noShow} />
        {attendance.revoked > 0 && (
          <Stat label={t('attendance.revoked')} value={attendance.revoked} />
        )}
      </div>

      <div className="row">
        <button
          className={onlyNoShow ? 'button button--quiet small' : 'button small'}
          onClick={() => setOnlyNoShow(false)}
        >
          {t('attendance.all')}
        </button>
        <button
          className={onlyNoShow ? 'button small' : 'button button--quiet small'}
          onClick={() => setOnlyNoShow(true)}
        >
          {t('attendance.onlyNoShow')}
        </button>
      </div>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>{t('attendance.column.reference')}</th>
              <th>{t('attendance.column.name')}</th>
              <th>{t('attendance.column.email')}</th>
              <th>{t('attendance.column.status')}</th>
              <th>{t('attendance.column.checkedInAt')}</th>
              {user?.role === 'admin' && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((attendee) => (
              <tr key={attendee.submissionId}>
                <td>{attendee.reference}</td>
                <td>{attendee.name}</td>
                <td>{attendee.email ?? ''}</td>
                <td>{statusOf(attendee)}</td>
                <td>{attendee.checkedInAt ? formatDateTime(locale, attendee.checkedInAt) : ''}</td>
                {user?.role === 'admin' && (
                  <td>
                    {!attendee.revoked && (
                      <button
                        className="button button--quiet small"
                        onClick={() => revoke(attendee)}
                      >
                        {t('events.archive')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
