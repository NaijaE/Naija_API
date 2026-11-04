const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })
// "YYYY-MM-DD" in Lagos time. The daily video limit resets at Lagos midnight.
export const lagosDay = (d = new Date()) => fmt.format(d)
