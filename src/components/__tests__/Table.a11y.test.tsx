import { render, screen } from '@testing-library/react';
import Table from '../Table';

describe('Table accessibility', () => {
  it('renders a native table element discoverable by role', () => {
    render(
      <Table>
        <thead>
          <tr>
            <th scope="col">Col A</th>
            <th scope="col">Col B</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A1</td>
            <td>B1</td>
          </tr>
        </tbody>
      </Table>
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    // Ensure headers are exposed as columnheaders via scope="col"
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBe(2);
    expect(headers[0]).toHaveTextContent('Col A');
  });
});


