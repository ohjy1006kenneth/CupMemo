import { CoffeeForm } from '../../../../components/coffee-form';

export default function NewCoffeePage() {
  return (
    <>
      <h1>Add a coffee</h1>
      <p className="auth-intro">
        Enter the details from your coffee bag. Only the roaster and coffee name are required; leave
        anything you don’t know empty.
      </p>
      <CoffeeForm />
    </>
  );
}
